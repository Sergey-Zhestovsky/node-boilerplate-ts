import events from 'events';
import { Server, Socket } from 'socket.io';

import { ClientError, Client401Error, Client500Error } from '@/libs/server-responses/ClientError';
import { ClientRedirection, ServerError } from '@/libs/server-responses';
import { HealthManager } from '@/libs/health-manager';
import { Config } from '@/libs/config';

events.captureRejections = true;

const handleError = (error: Error, socket: Socket) => {
  if (error instanceof ClientError) {
    socket.emit('error', error.getError());
    if (error instanceof Client401Error) socket.disconnect();
    return;
  }

  if (error instanceof ClientRedirection) {
    socket.emit('redirect', error.getRedirection());
    socket.disconnect();
    return;
  }

  const errMessage = `Unhandled error: '${error.name}': '${error.message}'.\n${error.stack ?? ''}`;
  HealthManager.report(errMessage);

  const serverError = new ServerError(error);

  if (Config.isDevelopment()) {
    socket.emit('error', serverError.getError());
  } else {
    socket.emit('error', new Client500Error().getError());
  }
};

const rejectHandler = (server: Server, socket: Socket) => {
  // @ts-ignore: Valid syntax due to https://nodejs.org/api/events.html#events_emitter_symbol_for_nodejs_rejection_err_eventname_args
  socket[Symbol.for('nodejs.rejection')] = (error: Error) => handleError(error, socket);
};

const basicHandler = (server: Server, socket: Socket) => {
  socket.on('error', (error: Error) => handleError(error, socket));
};

export = [rejectHandler, basicHandler];
