interface Queue<T> {
  enqueue: (value: T) => void
  dequeue: () => T | null

  [Symbol.iterator]: () => Iterator<T>
  size: number
}

interface Node<T> {
  value: T
  next: Node<T> | null
}

export function createLinkedListQueue<T> (): Queue<T> {
  let front: Node<T> | null = null
  let rear: Node<T> | null = null

  let size = 0
  return {
    enqueue: (value) => {
      const node = { value, next: null }
      if (rear === null) {
        front = node
        rear = node
      } else {
        rear.next = node
        rear = node
      }

      size++
    },

    dequeue: () => {
      if (front === null) return null
      const node = front
      front = front.next
      if (front === null) rear = null

      size--
      return node.value
    },

    get size () {
      return size
    },

    [Symbol.iterator]: function * () {
      let node = front
      while (node !== null) {
        yield node.value
        node = node.next
      }
    }
  }
}

/**
 * This represents the result of a read() or write() call on the async channel.
 *
 * - If the channel is in a closed state, this will have `closed` set to `true`
 *   and `error` set to the error passed to `close` when closing the channel.
 * - If the channel is not in a closed state, this will have `closed` set to
 *   `false` and `value` that was read or written to the channel.
 */
export type MaybeClosedResult<T> =
    | { closed: false, value: T }
    | { closed: true, error?: Error }

/**
* This represents an unbounded async channel. It is unbounded in the sense that
* write calls will never block and the values will be buffered until they are
* read. It is async in the sense that read() calls will return a promise that
* resolves when a value is written to the channel.
*
* The pending promise from read call will also resolve if the channel is closed
* using the `close` method.
*
* `[Symbol.asyncIterator]` is implemented so that the channel can be used in a
* for await loop. The iterator will consume all exiting values in the channel
* even if the channel was closed while iterating and will throw an error after
* that if the channel was closed with an error.
*/
export interface UnboundedAsyncChannel<T> {
  /**
     * Write a value to the channel.
     *
     * @param value The value to write.
     * @returns This returns a `MaybeClosedResult`.
     *
     *   - If the channel is in the closed state, the `MaybeClosedResult` returned
     *       will have `closed` set to `true` and `error` set to the error passed
     *       to `close()`.
     *   - If the channel is not in the closed state, the `MaybeClosedResult` returned
     *       will have `closed` set to `false` and `value`.
     *
     * @throws This never throws.
     */
  write: (value: T) => MaybeClosedResult<T>

  /**
     * Read a value from the channel.
     *
     * @returns This returns a promise that resolves to a `MaybeClosedResult`.
     *
     *   - If the channel is in the closed state, this will resolve with any
     *       unconsumed values in the channel and then resolve with a
     *       `MaybeClosedResult` with `closed` set to `true` and `error` set to
     *       the error passed to the `close` method when closing the channel.
     *   - If the channel is not in the closed state, this will resolve with the next
     *       value written to the channel.
     *
     * @throws This never throws.
     */
  read: () => Promise<MaybeClosedResult<T>>

  /**
     * Close the channel. This will cause all pending read() calls to resolve with
     * a `MaybeClosedResult` with `closed` set to `true` and `error` set to the
     * `err`. Calling close on a channel that is already closed will have no
     * effect.
     *
     * @param err
     * @returns Void
     * @throws This never throws.
     */
  close: (err?: Error) => void

  /**
     * @returns The state of the channel.
     *
     *   - If the channel is in a closed state, this will return an object with
     *       `closed` set to `true` and `error` set to the error passed to close
     *       method when closing the channel.
     *   - If the channel is not in a closed state, this will return an object with
     *       `closed` set to `false`.
     */
  state: { closed: false } | { closed: true, error?: Error }

  /**
     * @returns An async iterator that will yield values from the channel.
     *   Iteration will throw an error if the channel is closed with an error
     *   after consuming the channel completely.
     */
  [Symbol.asyncIterator]: () => AsyncGenerator<T>
}

/**
* Creates an unbounded async channel.
*
* @returns An unbounded async channel.
*/
export function createUnboundedAsyncChannel<T> (): UnboundedAsyncChannel<T> {
  const promises = createLinkedListQueue<Promise<MaybeClosedResult<T>>>()

  const resolvers =
        createLinkedListQueue<(data: MaybeClosedResult<T>) => void>()

  let closed = false
  let error: Error | undefined

  function addPromise (): void {
    promises.enqueue(
      new Promise((resolve) => {
        resolvers.enqueue(resolve)
      })
    )
  }

  return {
    write: (value) => {
      if (closed) {
        if (error != null) {
          return {
            closed: true,
            error
          }
        } else {
          return { closed: true }
        }
      }

      if (resolvers.size === 0) addPromise()

      const resolve = resolvers.dequeue()
      if (resolve === null) {
        throw new Error('resolvers queue should not be empty')
      }
      resolve({ closed: false, value })

      return { closed: false, value }
    },

    read: async () => {
      if (closed && promises.size === 0) {
        if (error != null) {
          return {
            closed: true,
            error
          }
        } else {
          return { closed: true }
        }
      }

      if (promises.size === 0) addPromise()
      const promise = promises.dequeue()
      if (promise == null) throw new Error('promise queue should not be empty')

      return await promise
    },
    close: (err) => {
      if (closed) return

      closed = true
      error = err

      for (const resolve of resolvers) {
        if (err != null) {
          resolve({ error: err, closed: true })
        } else {
          resolve({
            closed: true
          })
        }
      }
    },

    get state () {
      return {
        closed,
        error
      }
    },

    [Symbol.asyncIterator]: async function * () {
      while (true) {
        const res = await this.read()
        if (res.closed) {
          if (res.error != null) {
            throw res.error
          } else {
            break
          }
        }
        yield res.value
      }
    }
  }
}
