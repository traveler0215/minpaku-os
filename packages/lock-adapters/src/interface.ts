export interface LockStatus {
  isLocked: boolean
  batteryLevel?: number  // 0-100
  lastSeen?: Date
}

export interface PasscodeInfo {
  passcodeId: string
  code: string
  validFrom: Date
  validTo: Date
}

export interface SmartLockAdapter {
  /**
   * 予約ごとのワンタイムパスコードを発行する
   */
  generatePasscode(
    reservationId: string,
    validFrom: Date,
    validTo: Date
  ): Promise<PasscodeInfo>

  /**
   * パスコードを無効化する（チェックアウト後）
   */
  revokePasscode(passcodeId: string): Promise<void>

  /**
   * スマートロックの現在状態を取得する
   */
  getStatus(lockId: string): Promise<LockStatus>
}
