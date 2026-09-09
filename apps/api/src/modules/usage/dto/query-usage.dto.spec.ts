import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { QueryUsageDto } from './query-usage.dto';
import {
  USAGE_DAILY_DEFAULT_DAYS,
  USAGE_DAILY_MAX_DAYS,
  USAGE_HISTORY_DEFAULT_LIMIT,
  USAGE_HISTORY_MAX_LIMIT,
} from '../usage.constants';

/**
 * The DTO writes its bounds as literals so the docs generator can read them
 * (see the class doc). This suite is what stops the two copies drifting: it
 * asserts the *behaviour* at each boundary, then checks that boundary is the
 * constant. Change the constant without the decorator and this fails.
 */
function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(QueryUsageDto, query, { enableImplicitConversion: true });
  return { dto, errors: validateSync(dto, { skipMissingProperties: false }) };
}

describe('QueryUsageDto', () => {
  it('defaults to the documented history limit and chart window', () => {
    const { dto, errors } = parse({});

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(USAGE_HISTORY_DEFAULT_LIMIT);
    expect(dto.days).toBe(USAGE_DAILY_DEFAULT_DAYS);
  });

  it('accepts the maximum limit and rejects one past it', () => {
    expect(parse({ limit: String(USAGE_HISTORY_MAX_LIMIT) }).errors).toHaveLength(0);
    expect(parse({ limit: String(USAGE_HISTORY_MAX_LIMIT + 1) }).errors).toHaveLength(1);
  });

  it('accepts the maximum window and rejects one past it', () => {
    expect(parse({ days: String(USAGE_DAILY_MAX_DAYS) }).errors).toHaveLength(0);
    expect(parse({ days: String(USAGE_DAILY_MAX_DAYS + 1) }).errors).toHaveLength(1);
  });

  it('rejects zero and negatives on both fields', () => {
    expect(parse({ limit: '0' }).errors).toHaveLength(1);
    expect(parse({ days: '-1' }).errors).toHaveLength(1);
  });

  it('rejects a fractional value rather than silently flooring it', () => {
    expect(parse({ days: '7.5' }).errors).toHaveLength(1);
  });

  it('coerces the query string, since every value off the wire is a string', () => {
    const { dto, errors } = parse({ limit: '25', days: '7' });

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(25);
    expect(dto.days).toBe(7);
  });
});
