#!/usr/bin/env node

// Entrypoint shim for `npx create-minpaku-os`
// Delegates to the compiled ESM module in dist/

import { main } from '../dist/index.js'

main().catch((error) => {
  console.error('\n❌ セットアップに失敗しました:')
  console.error(error?.stack ?? error?.message ?? error)
  process.exit(1)
})
