import { input, password, confirm } from '@inquirer/prompts'

export interface WizardAnswers {
  projectName: string
  ownerName: string
  ownerEmail: string
  lineChannelSecret: string
  lineChannelAccessToken: string
  liffId: string
  useSameChannelForStaff: boolean
}

export async function collectAnswers(): Promise<WizardAnswers> {
  const projectName = await input({
    message: 'プロジェクトのディレクトリ名',
    default: 'my-minpaku',
    validate: (value) => {
      if (!value.trim()) return 'ディレクトリ名は必須です'
      if (!/^[a-z0-9][a-z0-9-_]*$/i.test(value)) return '英数字・ハイフン・アンダースコアのみ使えます'
      return true
    },
  })

  const ownerName = await input({
    message: 'オーナー名（管理画面に表示されます）',
    default: 'オーナー',
    validate: (v) => v.trim().length > 0 || 'オーナー名は必須です',
  })

  const ownerEmail = await input({
    message: '管理者メールアドレス（ログインに使用）',
    validate: (v) => {
      if (!v.trim()) return 'メールアドレスは必須です'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return '有効なメールアドレスを入力してください'
      return true
    },
  })

  console.log()
  console.log('LINE 設定の前に以下を準備してください:')
  console.log('  1. LINE Developers Console でプロバイダー作成')
  console.log('  2. Messaging API チャネル作成 (スタッフ用ボット)')
  console.log('  3. LINEログインチャネル作成 + LIFFアプリ追加 (カレンダー入力用)')
  console.log('     ※ ボットリンク機能は「On (Aggressive)」にしてください')
  console.log()
  console.log('詳細: https://minpaku-os-admin.pages.dev/setup')
  console.log()

  const ready = await confirm({
    message: 'LINE チャネル作成は済んでいますか？',
    default: true,
  })

  if (!ready) {
    console.log()
    console.log('チャネルを作ってから再度実行してください。')
    process.exit(0)
  }

  const lineChannelSecret = await password({
    message: 'Messaging API の Channel Secret',
    mask: '*',
    validate: (v) => v.trim().length > 0 || 'Channel Secret は必須です',
  })

  const lineChannelAccessToken = await password({
    message: 'Messaging API の Channel Access Token',
    mask: '*',
    validate: (v) => v.trim().length > 0 || 'Channel Access Token は必須です',
  })

  const liffId = await input({
    message: 'LIFF ID (例: 2009755679-D2HguPG1)',
    validate: (v) => {
      if (!v.trim()) return 'LIFF ID は必須です'
      if (!/^\d+-\w+$/.test(v.trim())) return '形式が正しくありません (例: 2009755679-D2HguPG1)'
      return true
    },
  })

  return {
    projectName: projectName.trim(),
    ownerName: ownerName.trim(),
    ownerEmail: ownerEmail.trim().toLowerCase(),
    lineChannelSecret: lineChannelSecret.trim(),
    lineChannelAccessToken: lineChannelAccessToken.trim(),
    liffId: liffId.trim(),
    useSameChannelForStaff: true,
  }
}
