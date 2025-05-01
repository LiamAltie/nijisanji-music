// lambda_functions/checkNewYouTubeVideos.mjs

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

// 環境変数ロード (.env.local)
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });

// Sanity クライアント設定
const sanity = createClient({
  projectId: process.env.SANITY_STUDIO_PROJECT_ID,
  dataset: process.env.SANITY_STUDIO_DATASET,
  useCdn: false,
  apiVersion: "2025-04-29",
});

// DynamoDB v3 DocumentClient と資格情報
const REGION = process.env.AWS_REGION || "ap-northeast-1";
const awsConfig = { region: REGION };
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  awsConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}
const ddbClient = new DynamoDBClient(awsConfig);
const ddb = DynamoDBDocumentClient.from(ddbClient);

// 各種定数
const TABLE_NAME = process.env.DDB_TABLE_NAME || "YouTubeChannelVideos";
const DEFAULT_LAST_AT = "1970-01-01T00:00:00Z";
const RETENTION_SECONDS = 60 * 60 * 24 * 7; // 7日間保持
const YT_API_KEY = process.env.YOUTUBE_API_KEY;
const YT_API_URL = "https://www.googleapis.com/youtube/v3";
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// ——————————————————————————————————
// テーブルクリア
// ——————————————————————————————————
async function clearTable() {
  console.log(`\nClearing all items in ${TABLE_NAME}...`);
  let ExclusiveStartKey;
  do {
    const { Items, LastEvaluatedKey } = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ProjectionExpression: "channelId, videoId",
        ExclusiveStartKey,
      })
    );
    ExclusiveStartKey = LastEvaluatedKey;
    if (!Items || Items.length === 0) break;

    const deleteRequests = Items.map((item) => ({
      DeleteRequest: {
        Key: { channelId: item.channelId, videoId: item.videoId },
      },
    }));

    for (let i = 0; i < deleteRequests.length; i += 25) {
      const batch = deleteRequests.slice(i, i + 25);
      await ddb.send(
        new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: batch } })
      );
      console.log(`Deleted ${batch.length} items.`);
    }
  } while (ExclusiveStartKey);

  console.log("Table cleared.");
  process.exit(0);
}

// ——————————————————————————————————
// スキーマ表示
// ——————————————————————————————————
async function describeTableSchema() {
  console.log(`\nDescribing table schema for ${TABLE_NAME}...`);
  const { Table } = await ddbClient.send(
    new DescribeTableCommand({ TableName: TABLE_NAME })
  );
  console.log(JSON.stringify(Table, null, 2));
  process.exit(0);
}

// ——————————————————————————————————
// Sanity からチャンネル取得
// ——————————————————————————————————
async function fetchChannels() {
  console.log("Fetching channels from Sanity...");
  const channels = await sanity.fetch(`*[_type == "liver"]{ name, youtube }`);
  console.log(`Found ${channels.length} channels.`);
  return channels;
}

// ——————————————————————————————————
// URL→channelId 解決
// ——————————————————————————————————
async function parseChannelId(url) {
  const patterns = [
    { regex: /\/channel\/([^/?]+)/, handler: (m) => m[1] },
    {
      regex: /\/user\/([^/?]+)/,
      handler: async (m) => {
        const res = await axios.get(`${YT_API_URL}/channels`, {
          params: { key: YT_API_KEY, part: "id", forUsername: m[1] },
        });
        return res.data.items?.[0]?.id;
      },
    },
    {
      regex: /\/@([^/?]+)/,
      handler: async (m) => {
        const res = await axios.get(`${YT_API_URL}/search`, {
          params: {
            key: YT_API_KEY,
            part: "snippet",
            q: m[1],
            type: "channel",
            maxResults: 1,
          },
        });
        return res.data.items?.[0]?.snippet?.channelId;
      },
    },
    {
      regex: /\/c\/([^/?]+)/,
      handler: async (m) => {
        const res = await axios.get(`${YT_API_URL}/search`, {
          params: {
            key: YT_API_KEY,
            part: "snippet",
            q: m[1],
            type: "channel",
            maxResults: 1,
          },
        });
        return res.data.items?.[0]?.snippet?.channelId;
      },
    },
  ];
  for (const { regex, handler } of patterns) {
    const m = url.match(regex);
    if (m) return typeof handler === "function" ? await handler(m) : handler(m);
  }
  console.warn(`Could not resolve channelId for URL: ${url}`);
  return null;
}

// ——————————————————————————————————
// YouTube から最新動画取得
// ——————————————————————————————————
let quotaUsed = 0;
async function fetchLatestVideos(channelId) {
  console.log(`Fetching uploads for ${channelId}…`);

  // 1) channels.list で uploads playlistId を取得 → 1 ユニット
  quotaUsed += 1; // channels.list(part=contentDetails) のコスト
  const chRes = await axios.get(`${YT_API_URL}/channels`, {
    params: { key: YT_API_KEY, id: channelId, part: "contentDetails" },
  });
  const uploadsId =
    chRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return [];

  // 2) playlistItems.list でページング取得 → 1 ユニット／ページ
  const videos = [];
  let pageToken;
  do {
    quotaUsed += 1; // playlistItems.list(part=snippet) のコスト
    const plRes = await axios.get(`${YT_API_URL}/playlistItems`, {
      params: {
        key: YT_API_KEY,
        playlistId: uploadsId,
        part: "snippet",
        maxResults: 50,
        pageToken,
      },
    });
    pageToken = plRes.data.nextPageToken;
    for (const item of plRes.data.items) {
      const { resourceId, title, publishedAt } = item.snippet;
      videos.push({ videoId: resourceId.videoId, title, publishedAt });
    }
    if (videos.length >= 100) break; // 過去にさかのぼりすぎないガード
  } while (pageToken);

  // 日付降順にソートして最新10件だけ返す
  videos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const latest10 = videos.slice(0, 10);
  console.log(`Fetched ${latest10.length} uploads.`);

  return latest10;
}

// ——————————————————————————————————
// 最終通知日時取得 (GSI)
// ——————————————————————————————————
async function fetchLastNotifiedPublishedAt(channelId) {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "ChannelPublishedAtIndex",
      KeyConditionExpression: "channelId = :cid",
      ExpressionAttributeValues: { ":cid": channelId },
      ScanIndexForward: false,
      Limit: 1,
    })
  );
  return Items && Items.length > 0 ? Items[0].publishedAt : DEFAULT_LAST_AT;
}

// ——————————————————————————————————
// 新規動画をレコード (name を含む)
// ——————————————————————————————————
async function recordNewVideos(channelName, channelId, videos) {
  if (!videos.length) return;
  const nowEpoch = Math.floor(Date.now() / 1000);
  const putRequests = videos.map((v) => ({
    PutRequest: {
      Item: {
        channelId,
        videoId: v.videoId,
        name: channelName,
        title: v.title,
        publishedAt: v.publishedAt,
        ttl: nowEpoch + RETENTION_SECONDS,
      },
    },
  }));
  for (let i = 0; i < putRequests.length; i += 25) {
    const batch = putRequests.slice(i, i + 25);
    await ddb.send(
      new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: batch } })
    );
    console.log(`Recorded ${batch.length} items for ${channelName}.`);
  }
}

// ——————————————————————————————————
// Slack 通知
// ——————————————————————————————————
async function notifySlack(name, vids) {
  const blocks = vids.map((v) => ({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${name}* 新動画: <https://youtu.be/${v.videoId}|${v.title}>`,
    },
  }));
  await axios.post(SLACK_WEBHOOK_URL, { blocks });
  console.log("Slack sent.");
}

// ——————————————————————————————————
// メイン処理
// ——————————————————————————————————
async function main() {
  const channels = await fetchChannels();
  for (const { name, youtube } of channels) {
    const channelId = await parseChannelId(youtube);
    if (!channelId) continue;

    const latestVideos = await fetchLatestVideos(channelId);
    const lastAt = await fetchLastNotifiedPublishedAt(channelId);
    const newVideos = latestVideos.filter((v) => v.publishedAt > lastAt);
    const isFirstRun = lastAt === DEFAULT_LAST_AT;

    if (newVideos.length) {
      if (!isFirstRun) await notifySlack(name, newVideos);
      await recordNewVideos(name, channelId, newVideos);
    }
  }

  // ← ここで最終的な消費ユニットを表示
  console.log(
    `\n💡 YouTube Data API units used in this run: ${quotaUsed} units`
  );
}

// ——————————————————————————————————
// 実行ガード
// ——————————————————————————————————
(async () => {
  const args = process.argv.slice(2);
  if (args.includes("clear")) return clearTable();
  if (args.includes("describe")) return describeTableSchema();
  await main();
  console.log("Done.");
})();
