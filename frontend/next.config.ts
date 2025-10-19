import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  turbopack: {
    rules: {
      '**/*.{js,jsx,ts,tsx}': ['turbo-loader'],
    },
  },
  compiler: {
    removeConsole: false,
  },
  devIndicators: {
    position: 'bottom-right',
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
};

export default nextConfig;
