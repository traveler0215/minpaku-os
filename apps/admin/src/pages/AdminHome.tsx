export function AdminHomePage(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6 py-12">
      <section className="rounded-3xl border border-white/60 bg-white/70 p-10 text-center shadow-soft backdrop-blur">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-muted-foreground">minpaku-os</p>
        <h1 className="mt-4 text-3xl font-extrabold">管理画面ルート</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          `/shift-picker` は LIFF から認証なしで利用できます。それ以外の管理画面ページは後続実装で JWT 認証を追加してください。
        </p>
      </section>
    </main>
  )
}
