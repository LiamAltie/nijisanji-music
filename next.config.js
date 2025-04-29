const nextConfig = {
  env: {
    SANITY_STUDIO_PROJECT_ID: process.env.SANITY_STUDIO_PROJECT_ID,
    SANITY_STUDIO_DATASET: process.env.SANITY_STUDIO_DATASET,
  },
};

module.exports = {
  images: {
    domains: ["cdn.sanity.io"],
  },
  nextConfig,
};
