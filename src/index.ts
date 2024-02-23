import * as Y from 'yjs' // eslint-disable-line
import { decoding, encoding } from "lib0"
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as authProtocol from 'y-protocols/auth'

import { UnboundedAsyncChannel, createUnboundedAsyncChannel } from "./channel"

export const messageSync = 0
export const messageQueryAwareness = 3
export const messageAwareness = 1
export const messageAuth = 2

type MessageHandler = (encoder: encoding.Encoder, decoder: decoding.Decoder, provider: WebTransportProvider, emitSynced: boolean, messageType: number) => void;

type AwarenessUpdate = {
    added: number[],
    updated: number[],
    removed: number[]
}
const handers: Array<MessageHandler> = []

handers[messageSync] = (encoder, decoder, provider, emitSynced, messageType) => {
    encoding.writeVarUint(encoder, messageSync)
    const syncMessageType = syncProtocol.readSyncMessage(
        decoder,
        encoder,
        provider.doc,
        provider
    )
    if (
        emitSynced && syncMessageType === syncProtocol.messageYjsSyncStep2 &&
        !provider.synced
    ) {
        provider.synced = true
    }
}


handers[messageQueryAwareness] = (encoder, decoder, provider, emitSynced, messageType) => {
    encoding.writeVarUint(encoder, messageAwareness)
    encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(
            provider.awareness,
            [provider.doc.clientID]
        )
    )
 }


handers[messageAwareness] = (encoder, decoder, provider, emitSynced, messageType) => {
    awarenessProtocol.applyAwarenessUpdate(
        provider.awareness,
        decoding.readVarUint8Array(decoder),
        provider
    )
}

handers[messageAuth] = (encoder, decoder, provider, emitSynced, messageType) => {
    authProtocol.readAuthMessage(
        decoder,
        provider.doc,
        (_ydoc, reason) => permissionDeniedHandler(provider, reason)
      )
}


const readMessage = (provider: WebTransportProvider, buf: Uint8Array, emitSynced: boolean): encoding.Encoder => {
    const decoder = decoding.createDecoder(buf)
    const encoder = encoding.createEncoder()
    const messageType = decoding.readVarUint(decoder)
    const handler = handers[messageType]
    if (handler) {
        handler(encoder, decoder, provider, emitSynced, messageType)
    }

    return encoder
}
const permissionDeniedHandler = (provider: WebTransportProvider, reason: string) =>
  console.warn(`Permission denied to access ${provider.doc.clientID}.\n${reason}`)

type DisposableWriter<T> = WritableStreamDefaultWriter<T> & Disposable;
type DisposableReader<T> = ReadableStreamDefaultReader<T> & Disposable;

async function setup_web_transport(wt: WebTransport, doc: Y.Doc, opts: WebTransportProviderOptions) {
    await wt.ready
 
    const stream = opts.reliable ?  await wt.createBidirectionalStream() : wt.datagrams;
    let provider = new WebTransportProvider(stream, doc, opts);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeSyncStep1(encoder, provider.doc)
    provider.write_queued(encoding.toUint8Array(encoder))

    if (provider.awareness === null || provider.awareness?.getLocalState() === null) return;
    const awarenessEncoder = encoding.createEncoder()
    encoding.writeVarUint(awarenessEncoder, messageAwareness)
    encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(provider.awareness, [provider.doc.clientID]))
    provider.write_queued(encoding.toUint8Array(awarenessEncoder))
}

export interface WebTransportProviderOptions {
    reliable: boolean,
    connect: boolean
    params: Record<string, string>,
    awareness?: awarenessProtocol.Awareness | null
    resyncInterval?: number
    maxBackoffTime?: number
}
export class WebTransportProvider {
    stream: WebTransportBidirectionalStream | WebTransportDatagramDuplexStream

    write_channel: UnboundedAsyncChannel<Uint8Array>
    read_channel: UnboundedAsyncChannel<Uint8Array>

    synced: boolean
    doc: Y.Doc
    awareness: awarenessProtocol.Awareness

    _resyncInterval: number

    constructor(wt: WebTransportBidirectionalStream, doc: Y.Doc, opts: WebTransportProviderOptions) {
        this.stream = wt
        this.write_channel = createUnboundedAsyncChannel();
        this.read_channel = createUnboundedAsyncChannel();

        this.doc = doc
        this.synced = false
        this.awareness = opts.awareness ?? new awarenessProtocol.Awareness(doc);
        // Listens to Yjs updates and sends them to remote peers (ws and broadcastchannel)

        this.doc.on("update", (update: Uint8Array, origin: any) => {
            if (origin == this) return
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, messageSync)
            syncProtocol.writeUpdate(encoder, update)
            this.write_queued(encoding.toUint8Array(encoder))
        })

        this.awareness.on("update", ({added,updated,removed}: AwarenessUpdate) => {
            const changedClients = added.concat(updated).concat(removed)
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, messageAwareness)
            encoding.writeVarUint8Array(
                encoder,
                awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
            )
            this.write_queued(encoding.toUint8Array(encoder))
        })

        this._resyncInterval = setInterval(() => {
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, messageSync)
            syncProtocol.writeSyncStep1(encoder, doc)
            this.write_queued(encoding.toUint8Array(encoder))
        }, opts.resyncInterval ?? -1)
    }

    async handle_write() {
        for await (const value of this.write_channel) {
            using writer = this.getWriter<Uint8Array>();
            await writer.ready
            await writer.write(value)

        }
    }

    async handle_read() {
        let stream_done = false;
        while (!stream_done) {
            const { done, value } = await this.read_value()
            stream_done = done
            if (!value) continue;
            
            const encoder = readMessage(this, value, true);
            if(encoding.length(encoder) > 1) { 
                this.write_queued(encoding.toUint8Array(encoder))
            }
        }
    }

    async read_value() {
        using reader = this.getReader<Uint8Array>();
        return await reader.read();
    }
    write_queued(value: Uint8Array) {
        this.write_channel.write(value)
    }

    getReader<T>(): DisposableReader<T> {
        this.stream.readable.getReader()
        const reader = this.stream.readable.getReader()
        reader[Symbol.dispose] = () => { reader.releaseLock() }
        return reader as DisposableReader<T>;

    }

    getWriter<T>(): DisposableWriter<T> {
        const writer = this.stream.writable.getWriter()
        writer[Symbol.dispose] = () => { writer.releaseLock() }
        return writer as DisposableWriter<T>;
    }

    [Symbol.dispose]() {
        awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], "left");
        clearInterval(this._resyncInterval);
        void this.stream.readable.cancel();
        void this.stream.writable.close();
        this.read_channel.close()
        this.write_channel.close()
    }
}