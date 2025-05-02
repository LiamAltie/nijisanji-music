import dotenv from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@sanity/client";
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import axios from "axios";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });

// --- 定数定義 ---
const SANITY_STUDIO_PROJECT_ID = process.env.SANITY_STUDIO_PROJECT_ID;
const SANITY_STUDIO_DATASET = process.env.SANITY_STUDIO_DATASET;
const SANITY_API_TOKEN = process.env.SANITY_API_TOKEN;
const SANITY_API_VERSION = "2025-04-29"; // 日付は固定

const AWS_REGION = process.env.AWS_REGION || "ap-northeast-1";
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const DDB_TABLE_NAME = process.env.DDB_TABLE_NAME || "YouTubeChannelVideos";

const DEFAULT_LAST_AT = "1970-01-01T00:00:00Z"; // 最終取得日時のデフォルト値
const RETENTION_SECONDS = 60 * 60 * 24 * 7; // DynamoDB TTL (7日間)
const YT_API_KEY = process.env.YOUTUBE_API_KEY;
const YT_API_URL = "https://www.googleapis.com/youtube/v3";
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// --- グローバル変数 ---
let quotaUsed = 0; // YouTube API の使用クオータ数
const allNewVideos = []; // 処理全体で新しく追加された動画リスト

// --- Sanity Client 初期化 ---
const sanity = createClient({
  projectId: SANITY_STUDIO_PROJECT_ID,
  dataset: SANITY_STUDIO_DATASET,
  token: SANITY_API_TOKEN,
  useCdn: false,
  apiVersion: SANITY_API_VERSION,
});

// --- AWS SDK v3 DynamoDB Client 初期化 ---
const awsConfig = { region: AWS_REGION };
if (AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) {
  awsConfig.credentials = {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  };
}
const ddbClient = new DynamoDBClient(awsConfig);
const ddb = DynamoDBDocumentClient.from(ddbClient);

// ——————————————————————————————————
// DynamoDB テーブルの全項目を削除する (ユーティリティ)
// ——————————————————————————————————
async function clearTable() {
  console.log(
    `\n────────── テーブル全件削除開始: ${DDB_TABLE_NAME} ──────────`
  );
  let ExclusiveStartKey;
  let totalDeletedCount = 0;
  let page = 0;
  do {
    page++;
    const scanParams = {
      TableName: DDB_TABLE_NAME,
      ProjectionExpression: "channelId, videoId",
      ExclusiveStartKey,
    };
    const { Items, LastEvaluatedKey } = await ddb.send(
      new ScanCommand(scanParams)
    );
    ExclusiveStartKey = LastEvaluatedKey;

    if (!Items || Items.length === 0) {
      console.log(`ページ ${page}: 削除対象データなし。`);
      break;
    }
    console.log(`ページ ${page}: ${Items.length} 件の削除対象を取得。`);

    const deleteRequests = Items.map((item) => ({
      DeleteRequest: {
        Key: { channelId: item.channelId, videoId: item.videoId },
      },
    }));

    // バッチ書き込み (最大25件ずつ)
    for (let i = 0; i < deleteRequests.length; i += 25) {
      const batch = deleteRequests.slice(i, i + 25);
      const batchWriteParams = {
        RequestItems: { [DDB_TABLE_NAME]: batch },
      };
      try {
        await ddb.send(new BatchWriteCommand(batchWriteParams));
        console.log(`  バッチ削除成功: ${batch.length} 件`);
        totalDeletedCount += batch.length;
      } catch (error) {
        console.error("  バッチ削除エラー:", error);
        // 必要に応じてリトライ処理などを追加
      }
    }
  } while (ExclusiveStartKey);

  console.log(
    `────────── テーブル全件削除完了: ${DDB_TABLE_NAME} (合計 ${totalDeletedCount} 件削除) ──────────\n`
  );
  process.exit(0); // 処理終了
}

// ——————————————————————————————————
// DynamoDB テーブルの全項目を一覧表示する (ユーティリティ)
// ——————————————————————————————————
async function listItems() {
  console.log(
    `\n────────── テーブル項目一覧表示開始: ${DDB_TABLE_NAME} ──────────`
  );
  const allItems = [];
  let ExclusiveStartKey;
  let scanCount = 0;
  let page = 0;

  do {
    page++;
    const scanParams = {
      TableName: DDB_TABLE_NAME,
      ExclusiveStartKey,
    };
    console.log(`ページ ${page}: 項目をスキャン中...`);
    const { Items, LastEvaluatedKey, ScannedCount } = await ddb.send(
      new ScanCommand(scanParams)
    );
    console.log(`  ページ ${page}: ${ScannedCount} 件スキャン`);

    if (Items && Items.length > 0) {
      allItems.push(...Items);
      console.log(
        `  ページ ${page}: ${Items.length} 件取得 (現在合計: ${allItems.length} 件)`
      );
    } else {
      console.log(`  ページ ${page}: 新規取得項目なし。`);
    }
    ExclusiveStartKey = LastEvaluatedKey;
  } while (ExclusiveStartKey);

  console.log("全項目取得完了。");

  if (allItems.length === 0) {
    console.log("テーブルに項目が存在しません。");
    console.log(
      `────────── テーブル項目一覧表示完了: ${DDB_TABLE_NAME} ──────────\n`
    );
    return;
  }

  // 投稿日時で降順ソート
  allItems.sort((a, b) => {
    const dateA = a.publishedAt || DEFAULT_LAST_AT;
    const dateB = b.publishedAt || DEFAULT_LAST_AT;
    return dateB.localeCompare(dateA);
  });

  console.log(`\n--- 保存されている動画情報 (${allItems.length} 件) ---`);
  allItems.forEach((item, index) => {
    const ttlDate = item.ttl
      ? new Date(item.ttl * 1000).toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
        })
      : "設定なし";
    const publishedDate = item.publishedAt
      ? new Date(item.publishedAt).toLocaleString("ja-JP", {
          timeZone: "Asia/Tokyo",
        })
      : "不明";

    console.log(`\n[${index + 1}]`);
    console.log(`  チャンネル名: ${item.name || "(名前なし)"}`);
    console.log(`  動画タイトル: ${item.title || "(タイトルなし)"}`);
    console.log(`  投稿日時    : ${publishedDate}`);
    console.log(`  動画ID      : ${item.videoId || "(Video IDなし)"}`);
    console.log(`  チャンネルID: ${item.channelId || "(Channel IDなし)"}`);
    console.log(`  有効期限(TTL): ${ttlDate}`);
  });
  console.log(
    `────────── テーブル項目一覧表示完了: ${DDB_TABLE_NAME} ──────────\n`
  );
}

// ——————————————————————————————————
// DynamoDB テーブルのスキーマ情報を表示する (ユーティリティ)
// ——————————————————————————————————
async function describeTableSchema() {
  console.log(
    `\n────────── テーブルスキーマ表示開始: ${DDB_TABLE_NAME} ──────────`
  );
  try {
    const { Table } = await ddbClient.send(
      new DescribeTableCommand({ TableName: DDB_TABLE_NAME })
    );
    console.log("テーブル情報:");
    console.log(JSON.stringify(Table, null, 2));
  } catch (error) {
    console.error("テーブルスキーマの取得に失敗しました:", error);
  }
  console.log(
    `────────── テーブルスキーマ表示完了: ${DDB_TABLE_NAME} ──────────\n`
  );
  process.exit(0); // 処理終了
}

// ——————————————————————————————————
// Sanity CMSからチャンネルリストを取得する
// ——————————————————————————————————
async function fetchChannelsFromSanity() {
  console.log("Sanity CMS からチャンネルリストを取得しています...");
  try {
    const channels = await sanity.fetch(
      `*[_type == "liver"]{ _id, name, youtube, channelId }`
    );
    console.log(
      `Sanity から ${channels.length} 件のチャンネル情報を取得しました。`
    );
    return channels;
  } catch (error) {
    console.error("Sanity からのチャンネル取得に失敗しました:", error);
    return []; // エラー時は空配列を返す
  }
}

// ——————————————————————————————————
// Sanity CMSのドキュメントにYouTubeチャンネルIDを更新する
// ——————————————————————————————————
async function updateSanityChannelId(documentId, channelId) {
  if (!documentId || !channelId) {
    console.warn(
      "Sanity 更新スキップ: documentId または channelId が指定されていません。"
    );
    return;
  }
  if (!SANITY_API_TOKEN) {
    console.warn(
      "Sanity 更新スキップ: SANITY_API_TOKEN が設定されていません。"
    );
    return;
  }
  console.log(
    `Sanity ドキュメント (${documentId}) のチャンネルIDを更新します: ${channelId}`
  );
  try {
    await sanity.patch(documentId).set({ channelId }).commit();
    console.log(`Sanity ドキュメント (${documentId}) の更新が完了しました。`);
  } catch (error) {
    console.error(
      `Sanity ドキュメント (${documentId}) の更新中にエラーが発生しました:`,
      error
    );
  }
}

// ——————————————————————————————————
// YouTube チャンネルURLからチャンネルIDを解決する (複数パターン対応)
// ——————————————————————————————————
async function resolveChannelIdFromUrl(url) {
  if (!url) return null;

  // パターン1: /channel/UC...
  let match = url.match(/\/channel\/([a-zA-Z0-9_-]+)/);
  if (match) {
    console.log(`チャンネルID形式を検出: ${match[1]}`);
    return match[1];
  }

  // パターン2: /user/... (非推奨だが古い形式)
  match = url.match(/\/user\/([a-zA-Z0-9_-]+)/);
  if (match) {
    const username = match[1];
    console.log(
      `ユーザー名形式を検出: ${username}。チャンネルIDを検索します...`
    );
    try {
      quotaUsed += 1; // channels.list API コスト: 1
      console.log(
        `  [API] channels.list (forUsername=${username}) を実行 (+1 クオータ)`
      );
      const response = await axios.get(`${YT_API_URL}/channels`, {
        params: {
          key: YT_API_KEY,
          part: "id",
          forUsername: username,
          maxResults: 1,
        },
      });
      const channelId = response.data.items?.[0]?.id;
      if (channelId) {
        console.log(`  解決成功: ${username} -> ${channelId}`);
        return channelId;
      } else {
        console.warn(
          `  ユーザー名 ${username} に対応するチャンネルが見つかりませんでした。`
        );
      }
    } catch (error) {
      console.error(
        `  ユーザー名 ${username} からのチャンネルID検索中にエラー:`,
        error.response?.data || error.message
      );
    }
  }

  // パターン3: /@handle
  match = url.match(/\/@([a-zA-Z0-9_.-]+)/);
  if (match) {
    const handle = match[1];
    console.log(`ハンドル形式を検出: @${handle}。チャンネルIDを検索します...`);
    try {
      quotaUsed += 100; // search.list API コスト: 100
      console.log(
        `  [API] search.list (q=@${handle}, type=channel) を実行 (+100 クオータ)`
      );
      const response = await axios.get(`${YT_API_URL}/search`, {
        params: {
          key: YT_API_KEY,
          part: "snippet",
          q: `@${handle}`, // ハンドルを検索クエリに使用
          type: "channel",
          maxResults: 1,
        },
      });
      const channelId = response.data.items?.[0]?.snippet?.channelId;
      if (channelId) {
        console.log(`  解決成功: @${handle} -> ${channelId}`);
        return channelId;
      } else {
        console.warn(
          `  ハンドル @${handle} に対応するチャンネルが見つかりませんでした。`
        );
      }
    } catch (error) {
      console.error(
        `  ハンドル @${handle} からのチャンネルID検索中にエラー:`,
        error.response?.data || error.message
      );
    }
  }

  // パターン4: /c/CustomName (古いカスタムURL)
  match = url.match(/\/c\/([a-zA-Z0-9_-]+)/);
  if (match) {
    const customName = match[1];
    console.log(
      `カスタムURL形式 (/c/) を検出: ${customName}。チャンネルIDを検索します...`
    );
    // カスタムURLはハンドルと同様の検索で試みる (確実ではない)
    try {
      quotaUsed += 100; // search.list API コスト: 100
      console.log(
        `  [API] search.list (q=${customName}, type=channel) を実行 (+100 クオータ)`
      );
      const response = await axios.get(`${YT_API_URL}/search`, {
        params: {
          key: YT_API_KEY,
          part: "snippet",
          q: customName,
          type: "channel",
          maxResults: 1,
        },
      });
      const channelId = response.data.items?.[0]?.snippet?.channelId;
      if (channelId) {
        console.log(`  解決成功: ${customName} -> ${channelId}`);
        return channelId;
      } else {
        console.warn(
          `  カスタムURL ${customName} に対応するチャンネルが見つかりませんでした。`
        );
      }
    } catch (error) {
      console.error(
        `  カスタムURL ${customName} からのチャンネルID検索中にエラー:`,
        error.response?.data || error.message
      );
    }
  }

  console.warn(
    `URL ${url} からチャンネルIDを解決できませんでした。他の形式の可能性があります。`
  );
  return null;
}

// (1/2 からの続き)

// ——————————————————————————————————
// ISO 8601 形式の動画再生時間を秒数に変換する
// ——————————————————————————————————
function parseISO8601Duration(duration) {
  if (!duration || typeof duration !== "string" || !duration.startsWith("PT")) {
    // 不正な形式の場合は 0 を返すか、エラー処理を行う (ここでは 0 を返す)
    // 時間(H)や日(D)が含まれる場合はShortsではないと判断し、61秒以上として扱う
    if (duration && (duration.includes("H") || duration.includes("D"))) {
      return 61; // 60秒より大きい値（例: 61）を返し、Shorts判定から除外
    }
    return 0;
  }
  // PT[nM][nS] の形式をパース (時間や日は無視し、分と秒のみ考慮)
  const regex = /PT(?:(\d+)M)?(?:(\d+)S)?/;
  const matches = duration.match(regex);
  if (!matches) {
    // HやDがないが、MやSもない場合（例: PT）は0秒とする
    return 0;
  }
  const minutes = parseInt(matches[1] || "0", 10);
  const seconds = parseInt(matches[2] || "0", 10);
  return minutes * 60 + seconds;
}

// ——————————————————————————————————
// YouTube Data API v3 を使用してチャンネルの最新動画リストを取得する (ライブ配信、Shortsを除外)
// ——————————————————————————————————
async function fetchLatestVideos(channelId) {
  console.log(`  チャンネル (${channelId}) の最新動画を取得します...`);
  let channelUploadsPlaylistId = null;

  // 1. チャンネル情報からアップロード再生リストIDを取得
  try {
    quotaUsed += 1; // channels.list API コスト: 1
    console.log(
      `    [API] channels.list (part=contentDetails, id=${channelId}) を実行 (+1 クオータ)`
    );
    const chResponse = await axios.get(`${YT_API_URL}/channels`, {
      params: {
        key: YT_API_KEY,
        id: channelId,
        part: "contentDetails",
      },
    });
    channelUploadsPlaylistId =
      chResponse.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

    if (!channelUploadsPlaylistId) {
      console.warn(
        `    チャンネル (${channelId}) のアップロード再生リストIDが見つかりませんでした。`
      );
      return [];
    }
    console.log(`    アップロード再生リストID: ${channelUploadsPlaylistId}`);
  } catch (error) {
    console.error(
      `    チャンネル情報 (${channelId}) の取得中にエラー:`,
      error.response?.data || error.message
    );
    return []; // エラー時は空リストを返す
  }

  // 2. アップロード再生リストから動画アイテムを取得 (最大3ページ = 約150件まで)
  const playlistItems = [];
  let nextPageToken = null;
  const maxPages = 3; // 取得する最大ページ数
  console.log(
    `    再生リスト (${channelUploadsPlaylistId}) のアイテムを取得します (最大 ${maxPages} ページ)...`
  );
  for (let page = 1; page <= maxPages; page++) {
    try {
      quotaUsed += 1; // playlistItems.list API コスト: 1
      console.log(
        `      [API] playlistItems.list (ページ ${page}) を実行 (+1 クオータ)`
      );
      const plResponse = await axios.get(`${YT_API_URL}/playlistItems`, {
        params: {
          key: YT_API_KEY,
          playlistId: channelUploadsPlaylistId,
          part: "snippet", // videoId, title, publishedAt を含む
          maxResults: 50, // 1ページあたり最大50件
          pageToken: nextPageToken,
        },
      });

      const items = plResponse.data.items || [];
      playlistItems.push(...items);
      console.log(
        `      ページ ${page}: ${items.length} 件取得 (合計: ${playlistItems.length} 件)`
      );

      nextPageToken = plResponse.data.nextPageToken;
      if (!nextPageToken) {
        console.log("      最終ページに到達しました。");
        break; // 次のページがない場合はループ終了
      }
    } catch (error) {
      console.error(
        `    再生リストアイテム取得中にエラー (ページ ${page}):`,
        error.response?.data || error.message
      );
      break; // エラーが発生したら取得を中断
    }
  }
  console.log(
    `    再生リストから合計 ${playlistItems.length} 件のアイテムを取得しました。`
  );

  if (playlistItems.length === 0) return [];

  // 3. 動画IDリストを作成し、動画詳細情報 (ライブ配信有無、再生時間) を取得
  const videoIds = Array.from(
    new Set(
      playlistItems
        .map((item) => item.snippet?.resourceId?.videoId)
        .filter(Boolean)
    )
  );
  const videoDetailsMap = new Map(); // videoId をキーとして詳細情報を格納
  const liveVideoIds = new Set(); // ライブ配信だった動画のIDセット

  console.log(
    `    取得した ${videoIds.length} 件の動画の詳細情報 (ライブ配信、再生時間) を取得します...`
  );
  for (let i = 0; i < videoIds.length; i += 50) {
    const batchIds = videoIds.slice(i, i + 50);
    try {
      quotaUsed += 1; // videos.list API コスト: 1 (ID指定は50個まで1クオータ)
      console.log(
        `      [API] videos.list (バッチ ${i / 50 + 1}) を実行 (+1 クオータ)`
      );
      const vResponse = await axios.get(`${YT_API_URL}/videos`, {
        params: {
          key: YT_API_KEY,
          id: batchIds.join(","),
          part: "liveStreamingDetails,contentDetails", // ライブ配信情報とコンテント詳細 (再生時間含む)
        },
      });

      (vResponse.data.items || []).forEach((video) => {
        videoDetailsMap.set(video.id, video);
        // liveStreamingDetails が存在すればライブ配信 (アーカイブ含む)
        if (video.liveStreamingDetails) {
          liveVideoIds.add(video.id);
        }
      });
    } catch (error) {
      console.error(
        `    動画詳細情報取得中にエラー (バッチ ${i / 50 + 1}):`,
        error.response?.data || error.message
      );
      // エラーが発生しても処理を続行するが、該当バッチの動画情報は取得できない
    }
  }
  console.log(
    `    動画詳細情報の取得完了。ライブ配信動画 ${liveVideoIds.size} 件を検出。`
  );

  // 4. フィルタリング: ライブ配信を除外し、Shorts動画 (タイトル or 再生時間) を除外
  const filteredVideos = [];
  console.log("    動画をフィルタリングします (ライブ配信、Shortsを除外)...");
  for (const item of playlistItems) {
    const videoId = item.snippet?.resourceId?.videoId;
    const title = item.snippet?.title;
    const publishedAt = item.snippet?.publishedAt;

    if (!videoId || !title || !publishedAt) continue; // 必須情報がないものはスキップ

    // ライブ配信だった動画を除外
    if (liveVideoIds.has(videoId)) {
      // console.log(`      除外 (ライブ配信): ${title} (${videoId})`);
      continue;
    }

    // タイトルに #shorts (大文字小文字問わず) が含まれるものを除外
    if (title.toLowerCase().includes("#shorts")) {
      // console.log(`      除外 (タイトルShorts): ${title} (${videoId})`);
      continue;
    }

    // 再生時間でShortsを除外 (60秒以下)
    const details = videoDetailsMap.get(videoId);
    const duration = details?.contentDetails?.duration;
    if (duration) {
      const durationInSeconds = parseISO8601Duration(duration);
      if (durationInSeconds > 0 && durationInSeconds <= 60) {
        // console.log(`      除外 (再生時間Shorts): ${title} (${videoId}), ${durationInSeconds}秒`);
        continue;
      }
    } else {
      // 再生時間情報が取得できなかった場合 (APIエラーなど) は念のため残すか、除外するか選択
      // console.warn(`      警告: 動画 ${videoId} の再生時間不明。フィルタリングをスキップします。`);
    }

    // 上記フィルタを通過した動画を追加
    filteredVideos.push({ videoId, title, publishedAt });
  }
  console.log(`    フィルタリング後の動画数: ${filteredVideos.length} 件`);

  // 5. 投稿日時で降順ソートし、最新10件に絞る (APIからの取得順が新しいとは限らないため)
  return filteredVideos
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 10);
}

// ——————————————————————————————————
// DynamoDB から指定チャンネルの最後に記録された動画の公開日時を取得する
// ——————————————————————————————————
async function fetchLastNotifiedPublishedAt(channelId) {
  console.log(
    `  チャンネル (${channelId}) の最終通知日時を DynamoDB から取得します...`
  );
  try {
    const queryParams = {
      TableName: DDB_TABLE_NAME,
      IndexName: "ChannelPublishedAtIndex", // GSI を使用
      KeyConditionExpression: "channelId = :cid",
      ExpressionAttributeValues: { ":cid": channelId },
      ScanIndexForward: false, // publishedAt で降順ソート
      Limit: 1, // 最新の1件のみ取得
    };
    const { Items } = await ddb.send(new QueryCommand(queryParams));

    if (Items && Items.length > 0) {
      const lastPublishedAt = Items[0].publishedAt;
      console.log(`    最終通知日時: ${lastPublishedAt}`);
      return lastPublishedAt;
    } else {
      console.log(
        `    DynamoDB に ${channelId} の記録が見つかりません。デフォルト値を返します。`
      );
      return DEFAULT_LAST_AT; // 記録がない場合はデフォルト日時を返す
    }
  } catch (error) {
    console.error(
      `  DynamoDB から最終通知日時の取得中にエラー (${channelId}):`,
      error
    );
    return DEFAULT_LAST_AT; // エラー時もデフォルト日時を返す
  }
}

// ——————————————————————————————————
// 新規動画リストを DynamoDB に記録する (TTL付き)
// ——————————————————————————————————
async function recordNewVideosToDynamoDB(channelName, channelId, videos) {
  if (!videos || videos.length === 0) {
    console.log(
      `  チャンネル (${channelId}) の新規動画はありません。DynamoDB への記録をスキップします。`
    );
    return;
  }
  console.log(
    `  チャンネル (${channelId}) の新規動画 ${videos.length} 件を DynamoDB に記録します...`
  );
  const nowEpoch = Math.floor(Date.now() / 1000);
  const ttl = nowEpoch + RETENTION_SECONDS; // 現在時刻 + 保持期間 (秒)

  const putRequests = videos.map((video) => ({
    PutRequest: {
      Item: {
        channelId: channelId,
        videoId: video.videoId,
        name: channelName, // Sanity から取得したチャンネル名
        title: video.title,
        publishedAt: video.publishedAt,
        ttl: ttl, // TTL (Time To Live) 属性
      },
    },
  }));

  // バッチ書き込み (最大25件ずつ)
  for (let i = 0; i < putRequests.length; i += 25) {
    const batch = putRequests.slice(i, i + 25);
    const batchWriteParams = {
      RequestItems: { [DDB_TABLE_NAME]: batch },
    };
    try {
      await ddb.send(new BatchWriteCommand(batchWriteParams));
      console.log(`    DynamoDB バッチ書き込み成功: ${batch.length} 件`);
    } catch (error) {
      console.error("    DynamoDB バッチ書き込みエラー:", error);
      // 必要に応じてリトライ処理などを追加
    }
  }
}

// ——————————————————————————————————
// SlackにBlock Kitメッセージを送信する (共通ヘルパー関数)
// ——————————————————————————————————
async function sendSlackNotification(blocks, textFallback) {
  if (!SLACK_WEBHOOK_URL) {
    console.log("Slack Webhook URL が未設定のため、通知をスキップします。");
    return;
  }
  // フォールバックテキストがない場合は、blocksから簡易的に生成試みる
  const fallback =
    textFallback || (blocks && blocks[0]?.text?.text) || "Slack 通知";

  try {
    await axios.post(SLACK_WEBHOOK_URL, {
      text: fallback, // 通知テキスト (プレーンテキスト)
      blocks: blocks, // Block Kit blocks
    });
    console.log("Slack への通知が成功しました。");
  } catch (error) {
    console.error(
      "Slack への通知中にエラーが発生しました:",
      error.response?.data || error.message
    );
  }
}

// (notifySlack 関数は削除)

// ——————————————————————————————————
// メイン処理: チャンネル情報を取得し、各チャンネルの最新動画を確認・記録・通知する
// ——————————————————————————————————
async function main() {
  const startTime = Date.now();
  let processedChannelCount = 0; // 処理したチャンネル数
  let totalNewVideoCount = 0; // 全体の新規動画数

  // ① 実行開始通知
  await sendSlackNotification(
    [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:rocket: YouTube新着動画チェック処理を開始しました。\n(実行日時: ${new Date(startTime).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })})`,
        },
      },
    ],
    "YouTube新着動画チェック処理を開始しました。"
  );

  try {
    // 1. Sanity からチャンネルリストを取得
    const channels = await fetchChannelsFromSanity();
    if (!channels || channels.length === 0) {
      console.log(
        "処理対象のチャンネルが Sanity に登録されていません。処理を終了します。"
      );
      // 成功通知 (チャンネル0件)
      await sendSlackNotification(
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:information_source: 処理完了: 処理対象のチャンネルが0件でした。`,
            },
          },
        ],
        "処理完了: 処理対象チャンネル0件"
      );
      return;
    }
    const totalChannels = channels.length;

    console.log(
      `\n────────── ${totalChannels} 件のチャンネル処理を開始 ──────────`
    );

    // 2. 各チャンネルを処理
    for (const channel of channels) {
      const channelName = channel.name || "(名前未設定)";
      const sanityDocId = channel._id;
      const youtubeUrl = channel.youtube;
      let currentChannelId = channel.channelId;

      console.log(
        `\n--- チャンネル処理開始: ${channelName} (Sanity Doc ID: ${sanityDocId}) ---`
      );
      processedChannelCount++; // 処理開始したチャンネル数をカウント

      try {
        // (チャンネルID解決、最終通知日時取得、最新動画取得のロジックは変更なし)
        // ... (省略) ...
        if (!currentChannelId && youtubeUrl) {
          console.log(
            `  YouTube URL (${youtubeUrl}) からチャンネルIDを解決します...`
          );
          currentChannelId = await resolveChannelIdFromUrl(youtubeUrl);
          if (currentChannelId) {
            await updateSanityChannelId(sanityDocId, currentChannelId);
          }
        }
        if (!currentChannelId) {
          console.warn(
            `  チャンネルIDが見つからないため、このチャンネル (${channelName}) の処理をスキップします。`
          );
          continue;
        }
        console.log(`  処理対象チャンネルID: ${currentChannelId}`);
        const lastNotifiedAt =
          await fetchLastNotifiedPublishedAt(currentChannelId);
        const latestVideos = await fetchLatestVideos(currentChannelId);
        const newVideos = latestVideos.filter(
          (video) => video.publishedAt > lastNotifiedAt
        );
        console.log(`  新規動画 ${newVideos.length} 件を検出しました。`);

        if (newVideos.length > 0) {
          totalNewVideoCount += newVideos.length; // 総新規動画数を加算
          // 新規動画情報をグローバル変数 or main関数スコープの変数に格納
          newVideos.forEach((video) => {
            allNewVideos.push({
              // allNewVideos は main の外で定義されている想定
              channelName: channelName,
              channelId: currentChannelId,
              title: video.title,
              videoId: video.videoId,
              publishedAt: video.publishedAt,
            });
          });

          // DynamoDB に記録 (変更なし)
          await recordNewVideosToDynamoDB(
            channelName,
            currentChannelId,
            newVideos
          );

          // Slackへの個別通知は削除
          // await notifySlack(channelName, newVideos);
        }
      } catch (error) {
        console.error(
          `チャンネル (${channelName} / ${currentChannelId || "ID不明"}) の処理中にエラーが発生しました:`,
          error
        );
        // エラーが発生しても次のチャンネルの処理を続ける
        // 必要であれば、ここでチャンネルごとのエラーをSlack通知することも可能
      } finally {
        console.log(`--- チャンネル処理終了: ${channelName} ---`);
      }
    } // チャンネルループ終了

    console.log(`\n────────── 全チャンネルの処理が完了 ──────────`);

    // 3. ② 成功通知
    const endTime = Date.now();
    const durationSeconds = ((endTime - startTime) / 1000).toFixed(1);
    const successBlocks = [];

    // サマリー情報
    successBlocks.push({
      type: "header",
      text: {
        type: "plain_text",
        text: ":white_check_mark: YouTube新着動画チェック完了",
        emoji: true,
      },
    });
    successBlocks.push({
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*処理時間:* ${durationSeconds} 秒` },
        {
          type: "mrkdwn",
          text: `*巡回チャンネル数:* ${processedChannelCount} / ${totalChannels} 件`,
        },
        { type: "mrkdwn", text: `*使用クオータ:* ${quotaUsed} 単位` },
        { type: "mrkdwn", text: `*新規動画数:* ${totalNewVideoCount} 件` },
      ],
    });
    successBlocks.push({ type: "divider" });

    // 新規動画リストとボタン
    if (allNewVideos.length > 0) {
      successBlocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "*新着動画リスト*" },
      });
      // 新しい順にソート
      allNewVideos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      allNewVideos.forEach((video) => {
        const publishedDate = new Date(video.publishedAt).toLocaleString(
          "ja-JP",
          { timeZone: "Asia/Tokyo" }
        );
        const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
        const escapedTitle = (video.title || "")
          .replace(/&/g, "&")
          .replace(/</g, "<")
          .replace(/>/g, ">");

        // 動画情報セクション
        successBlocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${video.channelName}*\n<${videoUrl}|${escapedTitle}>\n*公開日時:* ${publishedDate}`,
          },
        });

        // タスク追加ボタンアクション
        successBlocks.push({
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "タスクに追加", emoji: true },
              style: "primary", // ボタンのスタイル (primary, danger)
              action_id: "add_youtube_task", // このIDでボタン押下を識別
              // value にタスク化に必要な情報をJSON文字列で埋め込む
              value: JSON.stringify({
                videoId: video.videoId,
                title: video.title, // エスケープ前のタイトル
                channelName: video.channelName,
                publishedAt: video.publishedAt,
                videoUrl: videoUrl,
              }),
            },
          ],
        });
        successBlocks.push({ type: "divider" });
      });
    } else {
      successBlocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "新着動画はありませんでした。" },
      });
    }

    await sendSlackNotification(
      successBlocks,
      `YouTube新着動画チェック完了 (${totalNewVideoCount}件の新着)`
    );
  } catch (error) {
    // ③ 失敗通知
    console.error("\nメイン処理の実行中に致命的なエラーが発生しました:", error);
    const errorBlocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: ":x: YouTube新着動画チェック処理失敗",
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `処理中にエラーが発生しました。\n*エラーメッセージ:*\n\`\`\`${error.message || "不明なエラー"}\`\`\``,
        },
      },
      // エラースタックも表示する場合 (長くなる可能性あり)
      // {
      //   type: "section",
      //   text: { type: "mrkdwn", text: `*スタックトレース:*\n\`\`\`${error.stack || 'スタックトレースなし'}\`\`\`` }
      // }
    ];
    await sendSlackNotification(errorBlocks, "YouTube新着動画チェック処理失敗");
    process.exit(1); // エラーで終了
  } finally {
    // 最終的なコンソール出力 (変更なし)
    const endTime = Date.now();
    const durationMinutes = ((endTime - startTime) / 60000).toFixed(2);
    console.log("\n========= 最終結果 (コンソール) =========");
    console.log(`処理時間: ${durationMinutes} 分`);
    console.log(`巡回チャンネル数: ${processedChannelCount}`);
    console.log(`総使用 YouTube API クオータ数: ${quotaUsed} 単位`);
    console.log(`新規動画数: ${totalNewVideoCount} 件`);
    console.log("=======================================");
  }
}

// --- スクリプト実行 (変更なし) ---
if (process.argv.includes("--clear-table")) {
  // clearTable().catch(...)
} else if (process.argv.includes("--list-items")) {
  // listItems().catch(...)
} else if (process.argv.includes("--describe-schema")) {
  // describeTableSchema().catch(...)
} else {
  main(); // main 内で catch されるのでここでは catch 不要
}
