import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['server/src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'server/dist/index.cjs',
  banner: {
    js: '#!/usr/bin/env node',
  },
  logLevel: 'error',
})
