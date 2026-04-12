declare module 'tiged' {
  interface TigedEmitter {
    clone(target: string): Promise<void>
    on(event: 'info' | 'warn', listener: (msg: unknown) => void): void
  }
  interface TigedOptions {
    cache?: boolean
    force?: boolean
    verbose?: boolean
    mode?: 'tar' | 'git'
  }
  function tiged(source: string, options?: TigedOptions): TigedEmitter
  export default tiged
}
