import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { ConflictError } from '../errors/app-error';
import { RedisService } from '../redis/redis.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let redis: { get: jest.Mock; set: jest.Mock };
  let reflector: { get: jest.Mock };
  let store: Map<string, string>;

  function contextWith(request: Record<string, unknown>): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 201 }) }),
      getClass: () => ({ name: 'TestController' }),
      getHandler: () => ({ name: 'testRoute' }),
    } as unknown as ExecutionContext;
  }

  function handlerReturning(value: unknown): CallHandler {
    const handle = jest.fn(() => of(value));
    return { handle } as unknown as CallHandler;
  }

  beforeEach(() => {
    store = new Map();
    redis = {
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        if (!store.has(key)) store.set(key, value);
        return Promise.resolve('OK');
      }),
    };
    reflector = { get: jest.fn().mockReturnValue(3600) };
    interceptor = new IdempotencyInterceptor(
      reflector as unknown as Reflector,
      { client: redis } as unknown as RedisService,
    );
  });

  it('passes through untouched when the route carries no @Idempotent', async () => {
    reflector.get.mockReturnValue(undefined);
    const handler = handlerReturning({ id: 'room_1' });

    const result$ = await interceptor.intercept(contextWith({ headers: {} }), handler);

    expect(await firstValue(result$)).toEqual({ id: 'room_1' });
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('passes through untouched when no Idempotency-Key header is present', async () => {
    const handler = handlerReturning({ id: 'room_1' });

    await interceptor.intercept(contextWith({ headers: {} }), handler);

    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('ignores an absurdly long key rather than rejecting the request', async () => {
    const handler = handlerReturning({ id: 'room_1' });
    const longKey = 'x'.repeat(300);

    await interceptor.intercept(contextWith({ headers: { 'idempotency-key': longKey } }), handler);

    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('executes the handler and caches the response on a first call', async () => {
    const handler = handlerReturning({ id: 'room_1' });
    const request = { headers: { 'idempotency-key': 'abc' }, body: { name: 'general' } };

    const result$ = await interceptor.intercept(contextWith(request), handler);

    expect(await firstValue(result$)).toEqual({ id: 'room_1' });
    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it('replays the cached response instead of re-invoking the handler', async () => {
    const request = { headers: { 'idempotency-key': 'abc' }, body: { name: 'general' } };
    await interceptor.intercept(contextWith(request), handlerReturning({ id: 'room_1' }));

    const secondHandler = handlerReturning({ id: 'room_2' });
    const result$ = await interceptor.intercept(contextWith(request), secondHandler);

    expect(await firstValue(result$)).toEqual({ id: 'room_1' });
    expect(secondHandler.handle).not.toHaveBeenCalled();
  });

  it('rejects a reused key sent with a different request body', async () => {
    const first = { headers: { 'idempotency-key': 'abc' }, body: { name: 'general' } };
    await interceptor.intercept(contextWith(first), handlerReturning({ id: 'room_1' }));

    const second = { headers: { 'idempotency-key': 'abc' }, body: { name: 'different' } };
    await expect(interceptor.intercept(contextWith(second), handlerReturning({ id: 'room_2' }))).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('scopes the cache per caller, so two actors reusing the same key do not collide', async () => {
    const aliceRequest = {
      headers: { 'idempotency-key': 'abc' },
      body: { name: 'general' },
      apiKeyPublicId: 'rvk_alice',
    };
    await interceptor.intercept(contextWith(aliceRequest), handlerReturning({ id: 'room_alice' }));

    const bobHandler = handlerReturning({ id: 'room_bob' });
    const bobRequest = {
      headers: { 'idempotency-key': 'abc' },
      body: { name: 'general' },
      apiKeyPublicId: 'rvk_bob',
    };
    const result$ = await interceptor.intercept(contextWith(bobRequest), bobHandler);

    expect(await firstValue(result$)).toEqual({ id: 'room_bob' });
    expect(bobHandler.handle).toHaveBeenCalledTimes(1);
  });

  it('scopes the cache per route, so the same key on a different route does not collide', async () => {
    const request = { headers: { 'idempotency-key': 'abc' }, body: {} };
    await interceptor.intercept(contextWith(request), handlerReturning({ id: 'room_1' }));

    const otherRouteContext = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 201 }) }),
      getClass: () => ({ name: 'OtherController' }),
      getHandler: () => ({ name: 'otherRoute' }),
    } as unknown as ExecutionContext;
    const otherHandler = handlerReturning({ id: 'stream_1' });

    const result$ = await interceptor.intercept(otherRouteContext, otherHandler);

    expect(await firstValue(result$)).toEqual({ id: 'stream_1' });
    expect(otherHandler.handle).toHaveBeenCalledTimes(1);
  });

  it('fails open and executes the handler when the cache read errors', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    const handler = handlerReturning({ id: 'room_1' });

    const result$ = await interceptor.intercept(
      contextWith({ headers: { 'idempotency-key': 'abc' }, body: {} }),
      handler,
    );

    expect(await firstValue(result$)).toEqual({ id: 'room_1' });
    expect(handler.handle).toHaveBeenCalledTimes(1);
  });

  it('still returns the response when the cache write errors', async () => {
    redis.set.mockRejectedValue(new Error('redis down'));
    const handler = handlerReturning({ id: 'room_1' });

    const result$ = await interceptor.intercept(
      contextWith({ headers: { 'idempotency-key': 'abc' }, body: {} }),
      handler,
    );

    expect(await firstValue(result$)).toEqual({ id: 'room_1' });
  });

  it('never caches a response when the handler throws', async () => {
    const handler = {
      handle: jest.fn(() => {
        throw new Error('boom');
      }),
    } as unknown as CallHandler;

    await expect(
      interceptor.intercept(contextWith({ headers: { 'idempotency-key': 'abc' }, body: {} }), handler),
    ).rejects.toThrow('boom');
    expect(redis.set).not.toHaveBeenCalled();
  });
});

async function firstValue<T>(obs: { subscribe: (fn: (v: T) => void) => void }): Promise<T> {
  return new Promise((resolve) => obs.subscribe(resolve));
}
