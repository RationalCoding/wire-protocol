const Duplex = require('readable-stream').Duplex
const Buffer = require('safe-buffer').Buffer

const serializers = require('./serialize').serializers
const deserializers = require('./serialize').deserializers

const RESERVED_EVENTS = ['close', 'drain', 'error', 'finish', 'pipe', 'unpipe', 'data', 'end', 'readable', 'writable']

class WireProtocol extends Duplex {
  constructor (defs) {
    super()

    this._buffer = []
    this._bufferSize = 0
    this._currentDef = null

    this._defs = {}
    defs.forEach(this._addDef.bind(this))
  }

  _write (chunk, enc, next) {
    this._bufferSize += chunk.length
    this._buffer.push(chunk)

    this._continueParse(() => {
      next(null) // signal that we are ready for more data
    })
  }

  _continueParse (callback) {
    if (this._bufferSize >= this._parserSize) { // whilte we have enough to parse
      const buffer = (this._buffer.length === 1) // concat the buffer
        ? this._buffer[0]
        : Buffer.concat(this._buffer)

      this._bufferSize -= this._parserSize // subtract the parse size

      this._buffer = this._bufferSize // slice the to-be-parsed data from the buffer
        ? [buffer.slice(this._parserSize)]
        : []

      this._parser(buffer.slice(0, this._parserSize), () => {
        this._continueParse(callback)
      }) // parse the sliced data
    } else {
      callback() // done parsing, get more data
    }
  }

  _read () { /* we will write when ready */ }

  _parser (data, callback) {
    const deserializedData = this._currentDef.deserialize(data)
    this.emit(this._currentDef.name, deserializedData)
    this._currentDef.done(deserializedData, (nextDefName, nextLength) => {
      if (nextDefName != null) {
        this._currentDef = this._defs[nextDefName]
        this._parserSize = nextLength != null ? nextLength : this._currentDef.length
        callback()
      } else {
        this._end()
      }
    })
  }

  send (message, data) {
    const def = this._defs[message]

    if (!def) throw new Error(message + ' is not a known message definition.')

    if (data != null) {
      const serializedData = def.serialize(data)
      this.push(serializedData)
    }
  }

  _end () {
    this.push(null)

    this._buffer = null
    this._bufferSize = null
    this._currentDef = null
    this._defs = null
  }

  _addDef (d) {
    const def = Object.assign({}, d)
    def.type = def.type || 'buffer'
    if (def.type) {
      def.serialize = def.serialize || serializers[def.type]
      def.deserialize = def.deserialize || deserializers[def.type]
    }

    def.done = def.done || this._end.bind(this)

    if (def.name.indexOf(RESERVED_EVENTS) !== -1) {
      throw new Error('Reserved event name ' + def.name + ' cannot be used.')
    }

    if (def.first) {
      if (def.length == null) throw new Error('First message must specify a length!')
      this._currentDef = def
      this._parserSize = this._currentDef.length
    }

    this._defs[def.name] = def
  }
}

module.exports = WireProtocol
