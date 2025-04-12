import type { NextConfig } from 'next'
import path from 'path'
import webpack from 'webpack'

// Check if we're building for standalone distribution
const isStandaloneBuild = process.env.USE_LOCAL_STORAGE === 'true'

const nextConfig: NextConfig = {
  devIndicators: false,
  // Expose environment variables to the browser
  env: {
    AUTOBLOCKS_INGESTION_KEY: process.env.AUTOBLOCKS_INGESTION_KEY,
  },
  publicRuntimeConfig: {
    AUTOBLOCKS_INGESTION_KEY: process.env.AUTOBLOCKS_INGESTION_KEY,
  },
  images: {
    domains: [
      'avatars.githubusercontent.com',
      'oaidalleapiprodscus.blob.core.windows.net',
      'api.stability.ai',
    ],
    // Enable static image optimization for standalone export
    unoptimized: isStandaloneBuild,
  },
  // Always use 'standalone' output to support API routes
  output: 'standalone',
  webpack: (config, { isServer }) => {
    // Configure webpack to use memory cache instead of filesystem cache
    // This avoids the serialization of large strings during the build process
    if (config.cache) {
      config.cache = {
        type: 'memory',
        maxGenerations: 1,
      }
    }

    // Add support for ESM packages
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx', '.jsx'],
      '.mjs': ['.mjs', '.mts'],
      '.cjs': ['.cjs', '.cts'],
    }

    if (!isServer) {
      // Handle node: protocol imports
      config.resolve.alias = {
        ...config.resolve.alias,
        'node:async_hooks': false,
        '@opentelemetry/api': require.resolve('@opentelemetry/api'),
        '@opentelemetry/core': require.resolve('@opentelemetry/core'),
        '@opentelemetry/semantic-conventions': require.resolve(
          '@opentelemetry/semantic-conventions'
        ),
        '@opentelemetry/resources': require.resolve('@opentelemetry/resources'),
      }

      // Provide fallbacks for Node.js built-in modules in the browser
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        async_hooks: false,
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        http: require.resolve('stream-http'),
        https: require.resolve('https-browserify'),
        os: require.resolve('os-browserify/browser'),
        url: require.resolve('url/'),
        assert: require.resolve('assert/'),
        buffer: require.resolve('buffer/'),
      }

      // Add polyfills
      config.plugins.push(
        new webpack.ProvidePlugin({
          process: 'process/browser',
          Buffer: ['buffer', 'Buffer'],
        }),
        new webpack.NormalModuleReplacementPlugin(
          /node:async_hooks/,
          path.resolve(__dirname, 'lib/polyfills/async_hooks.ts')
        )
      )
    }

    return config
  },
  // Only include headers when not building for standalone export
  ...(isStandaloneBuild
    ? {}
    : {
        async headers() {
          return [
            {
              // API routes CORS headers
              source: '/api/:path*',
              headers: [
                { key: 'Access-Control-Allow-Credentials', value: 'true' },
                {
                  key: 'Access-Control-Allow-Origin',
                  value: 'https://localhost:3001',
                },
                {
                  key: 'Access-Control-Allow-Methods',
                  value: 'GET,POST,OPTIONS,PUT,DELETE',
                },
                {
                  key: 'Access-Control-Allow-Headers',
                  value:
                    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
                },
              ],
            },
            {
              // Apply Cross-Origin Isolation headers to all routes except those that use the Google Drive Picker
              source: '/((?!w/.*|api/auth/oauth/drive).*)',
              headers: [
                {
                  key: 'Cross-Origin-Embedder-Policy',
                  value: 'require-corp',
                },
                {
                  key: 'Cross-Origin-Opener-Policy',
                  value: 'same-origin',
                },
              ],
            },
            {
              // For routes that use the Google Drive Picker, only apply COOP but not COEP
              source: '/(w/.*|api/auth/oauth/drive)',
              headers: [
                {
                  key: 'Cross-Origin-Opener-Policy',
                  value: 'same-origin',
                },
              ],
            },
          ]
        },
      }),
  transpilePackages: [
    '@autoblocks/client',
    '@opentelemetry/api',
    '@opentelemetry/core',
    '@opentelemetry/semantic-conventions',
    '@opentelemetry/resources',
  ],
}

export default nextConfig
