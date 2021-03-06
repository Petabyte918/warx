// @flow

import { combineEpics } from 'redux-observable';
import { Observable } from 'rxjs/Observable';
import defaultRules from '../shared/default-rules';
import { sendAction } from "../socket";
import {isSignedIn} from "./module-players";
import type { Store, ActionInterface } from '../types/framework';
import type { State, Rules } from '../types/game';

// local types
type GameStateChangedAction = {
    +type: 'GAME_STATE_CHANGED',
    +origin: 'server',
    +data: {
        +state: State, // todo client and server state?
    }
};

type PingLatencyAction = {
    +type: 'PING_LATENCY',
    +origin: 'client',
    +data: {
        +latency: number,
    }
};

export type KeyDownAction = {
    +type: 'KEY_DOWN',
    +origin: 'client',
    +data: {
        +key: string,
    }
};

export type KeyUpAction = {
    +type: 'KEY_UP',
    +origin: 'client',
    +data: {
        +key: string,
    }
};

type Action = GameStateChangedAction | PingLatencyAction | KeyDownAction | KeyUpAction;

export const initialState = {
    rules: null,
    latency: null,
};

// actions
export const keyDown = ({ key }: { key: string }): KeyDownAction => ({
    type: 'KEY_DOWN',
    origin: 'client',
    data: {
        key
    }
});

export const keyUp = ({ key }: { key: string }): KeyUpAction => ({
    type: 'KEY_UP',
    origin: 'client',
    data: {
        key
    }
});

// reducer
export const reducer = (state: State, action: Action): State => {
    switch (action.type) {
        case 'GAME_STATE_CHANGED': {
            const { data: { state: newState } } = action;
            return {
                ...state,
                ...newState,
            };
        }

        case 'PING_LATENCY': {
            const { data: { latency } } = action;
            return {
                ...state,
                latency: latency
            };
        }

        default:
            return state;
    }
};

// selectors
export const getLatency = (state: State) => state.latency;
export const getRules = (state: State): Rules => state.rules || defaultRules;

// epics
// todo: remove this automated stuff, in favor of explicit server actions for now
const sendToServer = (action$) =>
    action$
        .filter(action => action.origin === 'client' && action.sendToServer === true)
        .do(action => {
            sendAction(action);
        })
        .ignoreElements();

const connected = (action$) =>
    // todo this time needs to come from the server
    action$
        .ofType('CONNECTED')
        .switchMap(() =>
            Observable.timer(0, 30000) // todo add ping time to config/rules
                .takeUntil(action$.ofType('DISCONNECTED'))
                .map(() => ({ type: 'PING', origin: 'client', data: { sendTime: new Date() } }))
                .do(action => sendAction(action))
        );

// todo: pings should go the other way, clients should not send their own ping
const pings = (action$, store: Store) =>
    Observable
        .combineLatest(
            action$.ofType('PING'),
            action$.ofType('PONG')
                .map(({ data, ...rest }) => ({ ...rest, data: { ...data, receiveTime: new Date() }}))
        )
        .map(([ping, pong]) =>
            ping.type === 'PING' && pong.type === 'PONG' ?
                ({
                    type: 'PING_LATENCY',
                    origin: 'client',
                    data: {
                        latency: pong.data.receiveTime - ping.data.sendTime
                    }
                }) : ({
                    type: 'PING_CORRUPT', // TODO
                    origin: 'client',
                })
        ).do(action => sendAction(action));


export type KeyActionMap = {
    [key: string]: () => ActionInterface
};

export const createKeyHandlerEpic = (keyActionMap: KeyActionMap, down: boolean = true) =>
    (action$, store) =>
        action$
            .ofType(down ? 'KEY_DOWN' : 'KEY_UP')
            .filter(({ data: { key } }) => keyActionMap[key] && isSignedIn(store.getState()))
            .map(({ data: { key } }) => keyActionMap[key]());

export const epic = combineEpics(
    sendToServer,
    connected,
    pings,
);
