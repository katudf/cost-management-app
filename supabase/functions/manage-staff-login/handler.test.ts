import { describe, it, expect, vi } from 'vitest';
import { handleAction, HttpError, type AdminClient } from './handler.ts';
import { LOGIN_ID_EMAIL_DOMAIN as FRONT_DOMAIN } from '../../../src/utils/loginId.js';
import { LOGIN_ID_EMAIL_DOMAIN } from './handler.ts';

const CALLER = 'caller-uid';
const META = { userAgent: 'UA', ipAddress: '1.2.3.4', forwardedFor: '1.2.3.4' };

type Staff = { id: number; name: string; role: string; auth_user_id: string | null };

/**
 * service_role クライアントの偽物。呼び出しを calls に順番に記録する。
 * rpcResults / authResults で関数ごとの戻り値を差し替えられる（配列なら呼ばれるたびに先頭から使う）。
 */
function fakeAdmin({
  target = { id: 10, name: '事務', role: 'office', auth_user_id: 'target-uid' } as Staff,
  user = { id: 'target-uid', email: 'old@example.com', last_sign_in_at: '2026-11-01T00:00:00Z' } as Record<string, unknown>,
  rpc = {} as Record<string, unknown>,
  auth = {} as Record<string, unknown>,
} = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const take = (table: Record<string, unknown>, key: string, fallback: unknown) => {
    const value = table[key];
    if (Array.isArray(value)) return value.length ? value.shift() : fallback;
    return value ?? fallback;
  };
  const admin: AdminClient = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push(['rpc:' + fn, args]);
      const fallback = fn === 'assert_can_manage_staff_login' ? { data: target, error: null } : { data: null, error: null };
      return take(rpc, fn, fallback) as { data: unknown; error: null };
    }),
    auth: {
      admin: {
        createUser: vi.fn(async (attrs) => {
          calls.push(['createUser', attrs]);
          return take(auth, 'createUser', { data: { user: { id: 'new-uid' } }, error: null }) as never;
        }),
        getUserById: vi.fn(async (id) => {
          calls.push(['getUserById', id]);
          return take(auth, 'getUserById', { data: { user }, error: null }) as never;
        }),
        updateUserById: vi.fn(async (id, attrs) => {
          calls.push(['updateUserById', id, attrs]);
          return take(auth, 'updateUserById', { data: {}, error: null }) as never;
        }),
        deleteUser: vi.fn(async (id) => {
          calls.push(['deleteUser', id]);
          return take(auth, 'deleteUser', { data: {}, error: null }) as never;
        }),
      },
    },
  };
  return { admin, calls, names: () => calls.map(c => c[0]) };
}

const denied = { data: null, error: { code: '42501', message: '管理者・システム管理者のログインは、システム管理者だけが操作できます。' } };

async function expectHttpError(promise: Promise<unknown>, status: number, message?: string) {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(status);
  if (message) expect(error.message).toContain(message);
}

describe('LOGIN_ID_EMAIL_DOMAIN', () => {
  it('画面側と同じドメインを使う', () => {
    expect(LOGIN_ID_EMAIL_DOMAIN).toBe(FRONT_DOMAIN);
  });
});

describe('共通の検査', () => {
  it('staffId が不正なら何もしない', async () => {
    const { admin, calls } = fakeAdmin();
    await expectHttpError(handleAction(admin, CALLER, { action: 'create', staffId: 'x' }, META), 400);
    expect(calls).toHaveLength(0);
  });

  it('権限がなければ 403 で、Auth には触らない', async () => {
    const { admin, names } = fakeAdmin({ rpc: { assert_can_manage_staff_login: denied } });
    await expectHttpError(handleAction(admin, CALLER, { action: 'reset_password', staffId: 10, password: 'password1' }, META), 403);
    expect(names()).toEqual(['rpc:assert_can_manage_staff_login']);
  });

  it('不明な action は 400', async () => {
    const { admin } = fakeAdmin();
    await expectHttpError(handleAction(admin, CALLER, { action: 'nope', staffId: 10 }, META), 400);
  });
});

describe('create', () => {
  const noLogin = { id: 10, name: '新人', role: 'office', auth_user_id: null };

  it('架空メールで作成して紐付ける', async () => {
    const { admin, calls, names } = fakeAdmin({ target: noLogin });
    const result = await handleAction(admin, CALLER, { action: 'create', staffId: 10, loginId: ' Tanaka01 ', password: 'password1' }, META);
    expect(result).toEqual({ success: true, loginId: 'tanaka01' });
    expect(names()).toEqual(['rpc:assert_can_manage_staff_login', 'createUser', 'rpc:link_staff_login']);
    expect(calls[1][1]).toMatchObject({ email: 'tanaka01@login.invalid', password: 'password1', email_confirm: true });
    expect(calls[2][1]).toEqual({ p_caller: CALLER, p_staff_id: 10, p_auth_user_id: 'new-uid' });
  });

  it('IDが既にあれば 409 にし、既存ユーザーには紐付けない', async () => {
    const { admin, names } = fakeAdmin({
      target: noLogin,
      auth: { createUser: { data: null, error: { code: 'email_exists', message: 'exists' } } },
    });
    await expectHttpError(handleAction(admin, CALLER, { action: 'create', staffId: 10, loginId: 'taken', password: 'password1' }, META), 409, '既に使われています');
    expect(names()).toEqual(['rpc:assert_can_manage_staff_login', 'createUser']);
  });

  it('紐付けに失敗したら作ったユーザーを消す', async () => {
    const { admin, calls, names } = fakeAdmin({
      target: noLogin,
      rpc: { link_staff_login: denied },
    });
    await expectHttpError(handleAction(admin, CALLER, { action: 'create', staffId: 10, loginId: 'tanaka01', password: 'password1' }, META), 403);
    expect(names()).toEqual(['rpc:assert_can_manage_staff_login', 'createUser', 'rpc:link_staff_login', 'deleteUser']);
    expect(calls[3][1]).toBe('new-uid');
  });

  it('既にログインがある担当者には発行しない', async () => {
    const { admin } = fakeAdmin();
    await expectHttpError(handleAction(admin, CALLER, { action: 'create', staffId: 10, loginId: 'tanaka01', password: 'password1' }, META), 409);
  });

  it('IDとパスワードの形式を確かめる', async () => {
    const { admin } = fakeAdmin({ target: noLogin });
    await expectHttpError(handleAction(admin, CALLER, { action: 'create', staffId: 10, loginId: 'a.b', password: 'password1' }, META), 400);
    await expectHttpError(handleAction(admin, CALLER, { action: 'create', staffId: 10, loginId: 'tanaka01', password: 'short' }, META), 400);
  });
});

describe('assign_login_id', () => {
  it('メールをIDに書き換え、権限を確かめ直す（パスワードは変えない）', async () => {
    const { admin, calls, names } = fakeAdmin();
    const result = await handleAction(admin, CALLER, { action: 'assign_login_id', staffId: 10, loginId: 'jimu' }, META);
    expect(result).toEqual({ success: true, loginId: 'jimu', logged: null });
    expect(names()).toEqual(['rpc:assert_can_manage_staff_login', 'getUserById', 'updateUserById', 'rpc:assert_can_manage_staff_login']);
    expect(calls[2][2]).toEqual({ email: 'jimu@login.invalid', email_confirm: true });
  });

  it('確かめ直しで権限が無くなっていたら元のメールに戻す', async () => {
    const { admin, calls, names } = fakeAdmin({
      rpc: { assert_can_manage_staff_login: [{ data: { id: 10, role: 'office', auth_user_id: 'target-uid' }, error: null }, denied] },
    });
    await expectHttpError(handleAction(admin, CALLER, { action: 'assign_login_id', staffId: 10, loginId: 'jimu', password: 'password1' }, META), 403);
    expect(names()).toEqual(['rpc:assert_can_manage_staff_login', 'getUserById', 'updateUserById', 'rpc:assert_can_manage_staff_login', 'updateUserById']);
    expect(calls[4][2]).toEqual({ email: 'old@example.com', email_confirm: true });
    // パスワードは設定していない
    expect(calls.some(c => c[0] === 'updateUserById' && (c[2] as Record<string, unknown>).password)).toBe(false);
  });

  it('パスワードを入れたら設定して履歴に残す', async () => {
    const { admin, names } = fakeAdmin();
    const result = await handleAction(admin, CALLER, { action: 'assign_login_id', staffId: 10, loginId: 'jimu', password: 'password1' }, META);
    expect(result.logged).toBe(true);
    expect(names()).toEqual([
      'rpc:assert_can_manage_staff_login', 'getUserById', 'updateUserById', 'rpc:assert_can_manage_staff_login',
      'updateUserById', 'rpc:log_admin_password_reset',
    ]);
  });

  it('一度もログインしていない人はパスワード必須', async () => {
    const { admin } = fakeAdmin({ user: { id: 'target-uid', email: 'old@example.com', last_sign_in_at: null } });
    await expectHttpError(handleAction(admin, CALLER, { action: 'assign_login_id', staffId: 10, loginId: 'jimu' }, META), 400, 'パスワードも入力');
  });

  it('既にIDがある人には割り当てない', async () => {
    const { admin } = fakeAdmin({ user: { id: 'target-uid', email: 'jimu@login.invalid', last_sign_in_at: 'x' } });
    await expectHttpError(handleAction(admin, CALLER, { action: 'assign_login_id', staffId: 10, loginId: 'jimu2' }, META), 409);
  });
});

describe('reset_password', () => {
  it('パスワードを変えて履歴に残す', async () => {
    const { admin, calls, names } = fakeAdmin();
    const result = await handleAction(admin, CALLER, { action: 'reset_password', staffId: 10, password: 'password1' }, META);
    expect(result).toEqual({ success: true, logged: true });
    expect(names()).toEqual(['rpc:assert_can_manage_staff_login', 'updateUserById', 'rpc:log_admin_password_reset']);
    expect(calls[2][1]).toMatchObject({ p_caller: CALLER, p_staff_id: 10, p_user_agent: 'UA', p_ip_address: '1.2.3.4' });
  });

  it('記録時の再確認で権限が無くなっていたら 403', async () => {
    const { admin } = fakeAdmin({ rpc: { log_admin_password_reset: denied } });
    await expectHttpError(handleAction(admin, CALLER, { action: 'reset_password', staffId: 10, password: 'password1' }, META), 403, 'システム管理者');
  });

  it('記録だけ失敗したら成功扱いで logged: false', async () => {
    const { admin } = fakeAdmin({ rpc: { log_admin_password_reset: { data: null, error: { code: 'XX000', message: 'boom' } } } });
    const result = await handleAction(admin, CALLER, { action: 'reset_password', staffId: 10, password: 'password1' }, META);
    expect(result).toEqual({ success: true, logged: false });
  });
});

describe('change_login_id', () => {
  const assigned = { id: 'target-uid', email: 'jimu@login.invalid', last_sign_in_at: 'x' };

  it('IDを変えて権限を確かめ直す', async () => {
    const { admin, calls, names } = fakeAdmin({ user: assigned });
    await handleAction(admin, CALLER, { action: 'change_login_id', staffId: 10, loginId: 'jimu2' }, META);
    expect(names()).toEqual(['rpc:assert_can_manage_staff_login', 'getUserById', 'updateUserById', 'rpc:assert_can_manage_staff_login']);
    expect(calls[2][2]).toEqual({ email: 'jimu2@login.invalid', email_confirm: true });
  });

  it('確かめ直しで権限が無くなっていたら元のIDに戻す', async () => {
    const { admin, calls } = fakeAdmin({
      user: assigned,
      rpc: { assert_can_manage_staff_login: [{ data: { id: 10, role: 'office', auth_user_id: 'target-uid' }, error: null }, denied] },
    });
    await expectHttpError(handleAction(admin, CALLER, { action: 'change_login_id', staffId: 10, loginId: 'jimu2' }, META), 403);
    expect(calls.at(-1)).toEqual(['updateUserById', 'target-uid', { email: 'jimu@login.invalid', email_confirm: true }]);
  });

  it('ID未割り当ての人は割り当てを使う', async () => {
    const { admin } = fakeAdmin();
    await expectHttpError(handleAction(admin, CALLER, { action: 'change_login_id', staffId: 10, loginId: 'jimu2' }, META), 400, 'ID割り当て');
  });
});

describe('delete', () => {
  it('BAN → 行の削除 → Auth ユーザーの削除の順に行う', async () => {
    const { admin, calls, names } = fakeAdmin();
    await handleAction(admin, CALLER, { action: 'delete', staffId: 10 }, META);
    expect(names()).toEqual(['rpc:assert_can_manage_staff_login', 'updateUserById', 'rpc:delete_staff_with_login', 'deleteUser']);
    expect(calls[1][2]).toEqual({ ban_duration: '876000h' });
  });

  it('行の削除に失敗したら BAN を解く', async () => {
    const { admin, calls } = fakeAdmin({ rpc: { delete_staff_with_login: denied } });
    await expectHttpError(handleAction(admin, CALLER, { action: 'delete', staffId: 10 }, META), 403);
    expect(calls.at(-1)).toEqual(['updateUserById', 'target-uid', { ban_duration: 'none' }]);
  });

  it('BAN に失敗したら何も消さない', async () => {
    const { admin, names } = fakeAdmin({ auth: { updateUserById: { data: null, error: { message: 'down' } } } });
    await expectHttpError(handleAction(admin, CALLER, { action: 'delete', staffId: 10 }, META), 500);
    expect(names()).toEqual(['rpc:assert_can_manage_staff_login', 'updateUserById']);
  });

  it('Auth ユーザーの削除だけ失敗したら、停止済みと伝える', async () => {
    const { admin } = fakeAdmin({ auth: { deleteUser: { data: null, error: { message: 'down' } } } });
    await expectHttpError(handleAction(admin, CALLER, { action: 'delete', staffId: 10 }, META), 500, 'ログインも停止');
  });

  it('自分自身は BAN する前に断る', async () => {
    const { admin, names } = fakeAdmin({ target: { id: 1, name: 'me', role: 'system_admin', auth_user_id: CALLER } });
    await expectHttpError(handleAction(admin, CALLER, { action: 'delete', staffId: 1 }, META), 403, '自分自身');
    expect(names()).toEqual(['rpc:assert_can_manage_staff_login']);
  });

  it('ログインのない担当者は行だけ消す', async () => {
    const { admin, names } = fakeAdmin({ target: { id: 10, name: 'x', role: 'office', auth_user_id: null } });
    await handleAction(admin, CALLER, { action: 'delete', staffId: 10 }, META);
    expect(names()).toEqual(['rpc:assert_can_manage_staff_login', 'rpc:delete_staff_with_login']);
  });
});
