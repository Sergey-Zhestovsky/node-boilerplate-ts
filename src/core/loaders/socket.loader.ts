/* eslint-disable unicorn/no-array-for-each */
/* eslint-disable @typescript-eslint/no-require-imports */

import http from 'http';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import { Server, Socket } from 'socket.io';

import { Logger } from '@/libs/logger';
import { Config } from '@/libs/config';

const logger = new Logger('Socket:Loader');

interface ISocketFile<T = unknown> {
  module: T;
  path: string;
  file: string;
}

type TEntryServerMiddleware = (socket: Socket, next: (err?: Error) => void) => void;
type TEntrySocketMiddleware = (event: unknown[], next: (err?: Error) => void) => void;
type TErrorHandlerMiddleware = (server: Server, socket: Socket) => void;

interface IMiddlewareFiles {
  entryServerFile: TEntryServerMiddleware[] | null;
  entrySocketFile: TEntrySocketMiddleware[] | null;
  errorHandlerFile: TErrorHandlerMiddleware[] | null;
}

type TControllerModel = (server: Server) => void | Record<string, TControllerModel>;

interface IHandlerFactory {
  inject(socket: Socket): void;
}

interface IDefaultOptions<T> {
  pathPattern: string;
  filesStructure: {
    middleware: {
      path: string;
      entryServerFile: string;
      entrySocketFile: string;
      errorHandlerFile: string;
    };
    handlers: string;
    controllers: string;
    namespaces: string;
  };
  socketHandlerFactory: (new (server: Server, handlers: T[]) => IHandlerFactory) | null;
}

const DEFAULT_OPTIONS: IDefaultOptions<unknown> = {
  /** relative folder path to file */
  pathPattern: './socket',
  filesStructure: {
    middleware: {
      path: '/middleware',
      entryServerFile: 'entry-server.ts',
      entrySocketFile: 'entry-socket.ts',
      errorHandlerFile: 'error-handler.ts',
    },
    handlers: '/handlers',
    controllers: '/controllers',
    namespaces: '/namespaces',
  },
  socketHandlerFactory: null,
};

const retrieveModule = <T = unknown>(
  pathToFile: string,
  errorMessage = 'Cant resolve path'
): T | null => {
  try {
    return require(pathToFile) as T;
  } catch {
    logger.warn(`${errorMessage} '${pathToFile}'`);
    return null;
  }
};

const retrieveFilesFromDir = <T = unknown>(dirPath: string) => {
  const root = fs.readdirSync(dirPath);
  const res: Array<ISocketFile<T>> = [];

  for (const file of root) {
    try {
      const module = require(path.join(dirPath, file)) as RequireModule<T>;

      res.push({
        // @ts-ignore: Suppose that `module.default` property comes from `export default`.
        module: module.default ?? module,
        path: dirPath,
        file: file,
      });
    } catch {
      logger.warn(`Cant retrieve '${file}' file from '${dirPath}'`);
    }
  }

  return res;
};

const applyControllers = (
  controllerFiles: Array<ISocketFile<TControllerModel>>,
  server: Server
) => {
  const processObject = (controller: TControllerModel) => {
    if (typeof controller === 'function') {
      controller(server);
    } else if (typeof controller === 'object') {
      for (const name in controller as Record<string, TControllerModel>) {
        processObject(controller[name]);
      }
    }
  };

  for (const { module } of controllerFiles) {
    processObject(module);
  }
};

const socketLoader = <T = unknown>(
  relativePath = __dirname,
  options: Partial<IDefaultOptions<T>> = DEFAULT_OPTIONS
) => {
  const fullConfig: IDefaultOptions<T> = _.merge({}, DEFAULT_OPTIONS, options);
  const rootPath = path.resolve(relativePath, fullConfig.pathPattern);

  // get (import) all files
  const middlewareFiles: IMiddlewareFiles = {
    entryServerFile: null,
    entrySocketFile: null,
    errorHandlerFile: null,
  };
  let handlerFiles: T[] = [];
  let controllerFiles: Array<ISocketFile<TControllerModel>> = [];

  // get middleware
  const mfs = fullConfig.filesStructure.middleware;
  const middlewareErr = 'Cant resolve socket middleware by path';
  const entryServerFilePath = path.join(rootPath, mfs.path, mfs.entryServerFile);
  middlewareFiles.entryServerFile = retrieveModule<TEntryServerMiddleware[]>(entryServerFilePath, middlewareErr) ?? [];
  const entrySocketFilePath = path.join(rootPath, mfs.path, mfs.entrySocketFile);
  middlewareFiles.entrySocketFile = retrieveModule<TEntrySocketMiddleware[]>(entrySocketFilePath, middlewareErr) ?? [];
  const errorHandlerFilePath = path.join(rootPath, mfs.path, mfs.errorHandlerFile);
  middlewareFiles.errorHandlerFile = retrieveModule<TErrorHandlerMiddleware[]>(errorHandlerFilePath, middlewareErr) ?? [];

  // get handlers
  if (fullConfig.socketHandlerFactory) {
    handlerFiles = retrieveFilesFromDir<T>(
      path.join(rootPath, fullConfig.filesStructure.handlers)
    ).map((v) => v.module);
  }

  // get controllers
  controllerFiles = retrieveFilesFromDir<TControllerModel>(
    path.join(rootPath, fullConfig.filesStructure.controllers)
  );

  // create and assemble server
  return (httpServer: http.Server) => {
    const io = new Server(httpServer, Config.global.socket);

    let socketHandlerFactory: IHandlerFactory | null = null;

    if (options.socketHandlerFactory) {
      socketHandlerFactory = new options.socketHandlerFactory(io, handlerFiles);
    }

    // apply server middleware
    middlewareFiles.entryServerFile?.forEach((middleware) => io.use(middleware));

    io.on('connection', (socket) => {
      // apply socket middleware
      middlewareFiles.entrySocketFile?.forEach((middleware) => socket.use(middleware));
      // apply error handlers
      middlewareFiles.errorHandlerFile?.forEach((middleware) => middleware(io, socket));
      // apply event handlers
      if (socketHandlerFactory !== null) socketHandlerFactory.inject(socket);
    });

    // apply controllers
    applyControllers(controllerFiles, io);

    // ? apply namespaces
    //

    return io;
  };
};

export default socketLoader;
