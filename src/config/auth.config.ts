import fs from 'fs';
import path from 'path';
import { ExtractJwt } from 'passport-jwt';

import { Environment } from '@/libs/config';
import { IJwtStrategyOptions } from '@/api/auth/types';

const getKeyFolder = (fileName: string = '') => {
  return path.resolve(__dirname, '../../keys', 'jwt', fileName);
};

const getKey = (filePath: string) => {
  try {
    return fs.readFileSync(filePath);
  } catch {
    const errMessage = `JWT key not found on path ${filePath}. Hint: run 'npm run generate-jwt-key-pair'`;
    throw new Error(errMessage);
  }
};

const jwtKeysOptions = {
  algorithm: 'rsa',
  keyLength: 4096,
  cipher: 'aes-256-ofb',
  passphrase: Environment.vars.AUTH_SERVER_SECRET,
  location: {
    keyPath: getKeyFolder(),
    publicKeyName: 'public.pem',
    publicKeyPath: getKeyFolder('public.pem'),
    privateKeyName: 'private.key',
    privateKeyPath: getKeyFolder('private.key'),
  },
};

const jwtOptions: IJwtStrategyOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  getSecretOrKey: getKey.bind(null, jwtKeysOptions.location.publicKeyPath),
  algorithms: ['RS512'],
};

const config = {
  jwtKeys: jwtKeysOptions,
  jwtStrategy: jwtOptions,
};

export default config;
