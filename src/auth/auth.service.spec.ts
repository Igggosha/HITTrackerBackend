import { GoneException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { db } from '../db/db';
import { pendingRegistrations, users } from '../db/schema';
import { AuthService } from './auth.service';

jest.mock('../db/db', () => ({
  db: { select: jest.fn(), insert: jest.fn(), delete: jest.fn(), update: jest.fn() },
}));

jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));

const queryFor = (result: unknown[]) => {
  const query: any = {};
  query.from = jest.fn(() => query);
  query.where = jest.fn(() => query);
  query.limit = jest.fn().mockResolvedValue(result);
  return query;
};

describe('AuthService email registration', () => {
  const mailer = { sendMail: jest.fn() };
  const service = new AuthService({} as any, mailer as any, {} as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps a new registration out of users until its code is verified', async () => {
    (db.select as jest.Mock).mockReturnValue(queryFor([]));
    (db.insert as jest.Mock).mockReturnValue({
      values: jest.fn().mockReturnValue({ onConflictDoUpdate: jest.fn().mockResolvedValue(undefined) }),
    });
    (bcrypt.hash as jest.Mock).mockResolvedValueOnce('password-hash').mockResolvedValueOnce('code-hash');

    await service.register({ fullName: 'Ada Lovelace', email: 'ADA@EXAMPLE.COM', password: 'Password1' });

    expect(db.insert).toHaveBeenCalledWith(pendingRegistrations);
    expect(db.insert).not.toHaveBeenCalledWith(users);
    expect(mailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ada@example.com' }));
  });

  it('rejects an expired verification code', async () => {
    (db.select as jest.Mock).mockReturnValue(queryFor([{
      email: 'ada@example.com',
      verificationCodeExpires: new Date(Date.now() - 1),
    }]));
    (db.delete as jest.Mock).mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });

    await expect(service.verifyRegistration({ email: 'ada@example.com', code: '123456' }))
      .rejects.toBeInstanceOf(GoneException);
  });
});
