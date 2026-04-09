import type { SmartLockAdapter, PasscodeInfo, LockStatus } from './interface'

/**
 * ManualAdapter: スマートロック未導入物件用
 * パスコードは管理者が手動で設定する前提。通知テキストのみ生成する。
 */
export class ManualAdapter implements SmartLockAdapter {
  async generatePasscode(
    reservationId: string,
    validFrom: Date,
    validTo: Date
  ): Promise<PasscodeInfo> {
    // 手動管理のためシステムではコードを発行しない
    // 管理画面でホストが手入力したコードが別途保存される
    return {
      passcodeId: `manual-${reservationId}`,
      code: '（管理画面で設定してください）',
      validFrom,
      validTo,
    }
  }

  async revokePasscode(_passcodeId: string): Promise<void> {
    // 手動対応のため何もしない
  }

  async getStatus(_lockId: string): Promise<LockStatus> {
    return { isLocked: false }
  }
}
