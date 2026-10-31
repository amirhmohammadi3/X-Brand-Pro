import 'reflect-metadata';
import { type Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { Roles, ROLES_KEY } from '../src/common/decorators/roles.decorator.js';
import { Public, IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import type { UserRole } from '@app/contracts';

function fakeContext(
  req: { user?: { id: string; role: UserRole; status: string } } = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => (): void => undefined,
    getClass: () => class Temporary {},
  } as unknown as ExecutionContext;
}

function makeGuardWith(spec: { isPublic?: boolean; roles?: string[] }): RolesGuard {
  const spy = (key: string) =>
    key === IS_PUBLIC_KEY ? spec.isPublic : key === ROLES_KEY ? spec.roles : undefined;
  return new RolesGuard({
    getAllAndOverride: (key: string) => spy(key),
  } as unknown as Reflector);
}

describe('RolesGuard RBAC matrix (B1.2)', () => {
  it('passes @Public routes without identity', () => {
    const guard = makeGuardWith({ isPublic: true });
    expect(guard.canActivate(fakeContext())).toBe(true);
  });

  it('passes routes without either decorator (ownership checks live in services)', () => {
    const guard = makeGuardWith({});
    expect(guard.canActivate(fakeContext())).toBe(true);
  });

  it('denies @Roles routes with 401 when no identity is attached (pre-B1.3)', () => {
    const guard = makeGuardWith({ roles: ['admin'] });
    try {
      guard.canActivate(fakeContext());
      throw new Error('expected the guard to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(401);
      expect(((e as HttpException).getResponse() as { code: string }).code).toBe('UNAUTHENTICATED');
    }
  });

  it('denies blocked users with 403 regardless of role', () => {
    const guard = makeGuardWith({ roles: ['admin'] });
    try {
      guard.canActivate(fakeContext({ user: { id: 'u1', role: 'admin', status: 'blocked' } }));
      throw new Error('expected the guard to throw');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(403);
    }
  });

  it('allows the exact role and denies others with 403', () => {
    const guard = makeGuardWith({ roles: ['moderator'] });
    expect(
      guard.canActivate(fakeContext({ user: { id: 'u1', role: 'moderator', status: 'active' } })),
    ).toBe(true);
    try {
      guard.canActivate(fakeContext({ user: { id: 'u2', role: 'user', status: 'active' } }));
      throw new Error('expected the guard to throw');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(403);
    }
  });

  it('super_admin satisfies any role requirement', () => {
    for (const required of ['user', 'owner', 'moderator', 'admin'] as const) {
      const guard = makeGuardWith({ roles: [required] });
      expect(
        guard.canActivate(
          fakeContext({ user: { id: 'root', role: 'super_admin', status: 'active' } }),
        ),
      ).toBe(true);
    }
  });

  it('any-of semantics: matching one of several required roles passes', () => {
    const guard = makeGuardWith({ roles: ['moderator', 'admin'] });
    expect(
      guard.canActivate(fakeContext({ user: { id: 'u3', role: 'moderator', status: 'active' } })),
    ).toBe(true);
  });

  it('the decorators store their metadata under the documented keys', () => {
    class Sample {
      @Public()
      @Roles('admin', 'super_admin')
      handler(): void {
        return undefined;
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(Sample.prototype, 'handler');
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, descriptor?.value)).toBe(true);
    expect(Reflect.getMetadata(ROLES_KEY, descriptor?.value)).toEqual(['admin', 'super_admin']);
  });
});
