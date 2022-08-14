class Peer {
  id;

  transports;

  producers;

  consumers;

  joinTs = null;

  lastSeenTs = null;

  media = {};

  consumerLayers = {};

  stats = {};

  dumpSyncStatus() {
    return {
      joinTs: this.joinTs,
      lastSeenTs: this.lastSeenTs,
      media: this.media,
      consumerLayers: this.consumerLayers,
      stats: this.stats,
    };
  }

  constructor(peerId, room) {
    this.id = peerId;
    this.room = room;
    this.joinTs = Date.now();
    this.lastSeenTs = Date.now();
    this.media = {};
    this.consumerLayers = {};
    this.stats = {};
    this.transports = {};
    this.producers = [];
    this.consumers = [];
  }

  async close() {
    Object.values(this.transports).forEach((transport) => {
      this.closeTransportObject(transport);
    });
  }

  async updateStats() {
    this.producers.forEach((producer) => {
      if (producer.kind === 'video') {
        try {
          const stats = producer.getStats();
          this.stats[producer.id] = stats.map((s) => ({
            bitrate: s.bitrate,
            fractionLost: s.fractionLost,
            jitter: s.jitter,
            score: s.score,
            rid: s.rid,
          }));
        } catch (e) {
          console.log('error while updating producer stats', e);
        }
      }
    });
    this.consumers.forEach((consumer) => {
      try {
        const stats = (consumer.getStats()).find((s) => s.type === 'outbound-rtp');
        this.stats[consumer.id] = [{
          bitrate: stats.bitrate, fractionLost: stats.fractionLost, score: stats.score,
        }];
      } catch (e) {
        console.log('error while updating consumer stats', e);
      }
    });
  }

  // TRANSPORTS
  findTransport(transportId, raise = true) {
    const transport = this.transports[transportId];
    if (raise && !transport) {
      console.error(`connect-transport: server-side transport ${transportId} not found`);
      throw Error(`server-side transport ${transportId} not found`);
    }
    return transport;
  }

  async closeTransportObject(transport) {
    try {
      console.log('closeTransport()', transport.id, transport.appData);

      // our producer and consumer event handlers will take care of
      // calling closeProducer() and closeConsumer() on all the producers
      // and consumers associated with this transport
      await transport.close();

      // so all we need to do, after we call transport.close(), is update
      // our roomState data structure
      delete this.transports[transport.id];
    } catch (e) {
      console.error(e);
    }
  }

  async crateNewTransport(direction) {
    // --> /signaling/create-transport
    //
    // create a mediasoup transport object and send back info needed
    // to create a transport object on the client side
    //
    const transport = await this.room.createWebRtcTransport({ peerId: this.id, direction });
    this.transports[transport.id] = transport;

    const {
      id, iceParameters, iceCandidates, dtlsParameters,
    } = transport;
    return {
      transportOptions: {
        id, iceParameters, iceCandidates, dtlsParameters,
      },
    };
  }

  async connectTransport(transportId, dtlsParameters) {
    // --> /signaling/connect-transport
    //
    // called from inside a client's `transport.on('connect')` event
    // handler.
    //
    const transport = this.findTransport(transportId);
    await transport.connect({ dtlsParameters });
    return { connected: true };
  }

  async closeTransport(transportId) {
    // --> /signaling/close-transport
    //
    // called by a client that wants to close a single transport (for
    // example, a client that is no longer sending any media).
    //
    const transport = this.findTransport(transportId);
    await this.closeTransportObject(transport);
    return { closed: true };
  }

  // PRODUCERS
  findProducer(producerId) {
    const producer = this.producers.find((p) => p.id === producerId);
    if (!producer) {
      console.error(`close-producer: server-side producer ${producerId} not found`);
      throw Error(`server-side producer ${producerId} not found`);
    }
    return producer;
  }

  async closeProducerObject(producer) {
    try {
      await producer.close();
      // remove this producer from our roomState.producers list
      this.producers = this.producers
        .filter((p) => p.id !== producer.id);

      // remove this track's info from our roomState...mediaTag bookkeeping
      if (producer.appData.peerId) {
        delete (this.media[producer.appData.mediaTag]);
      }
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async closeProducer(producerId) {
    // --> /signaling/close-producer
    //
    // called by a client that is no longer sending a specific track
    //
    const producer = this.findProducer(producerId);
    await this.closeProducerObject(producer);
    return { closed: true };
  }

  async pauseProducer(producerId) {
    // --> /signaling/pause-producer
    //
    // called to stop sending a track from a specific client
    //
    const producer = this.findProducer(producerId);
    await producer.pause();
    this.media[producer.appData.mediaTag].paused = true;
    return { paused: true };
  }

  async resumeProducer(producerId) {
    const producer = this.findProducer(producerId);
    await producer.resume();
    this.media[producer.appData.mediaTag].paused = false;
    return { resumed: true };
  }

  // CONSUMER
  findConsumer(consumerId) {
    const consumer = this.consumers.find((p) => p.id === consumerId);
    if (!consumer) {
      console.error(`close-producer: server-side producer ${consumerId} not found`);
      throw Error(`server-side producer ${consumerId} not found`);
    }
    return consumer;
  }

  async closeConsumerObject(consumer) {
    await consumer.close();

    // remove this consumer from our roomState.consumers list
    this.consumers = this.consumers.filter((c) => c.id !== consumer.id);

    // remove kernel info from from our roomState...consumerLayers bookkeeping
    if (consumer.appData.peerId) {
      delete this.consumerLayers[consumer.id];
    }
  }

  async pauseConsumer(consumerId) {
    // --> /signaling/pause-consumer
    //
    // called to pause receiving a track for a specific client
    //
    const consumer = this.findConsumer(consumerId);
    await consumer.pause();
    return { paused: true };
  }

  async resumeConsumer(consumerId) {
    // --> /signaling/resume-consumer
    //
    // called to resume receiving a track for a specific client
    //
    const consumer = this.findConsumer(consumerId);
    await consumer.resume();
    return { resumed: true };
  }

  async closeConsumer(consumerId) {
    // --> /signalign/close-consumer
    //
    // called to stop receiving a track for a specific client. close and
    // clean up consumer object
    //
    const consumer = this.findConsumer(consumerId);
    await this.closeConsumerObject(consumer);
    return { closed: true };
  }

  async consumerSetLayers(consumerId, spatialLayer) {
    // --> /signaling/consumer-set-layers
    //
    // called to set the largest spatial kernel that a specific client
    // wants to receive
    //
    const consumer = this.findConsumer(consumerId);
    await consumer.setPreferredLayers({ spatialLayer });
    return { layersSet: true };
  }

  // TRACKS
  async receiveTrack(mediaPeerId, mediaTag, rtpCapabilities) {
    // --> /signaling/recv-track
    //
    // create a mediasoup consumer object, hook it up to a producer here
    // on the server side, and send back info needed to create a consumer
    // object on the client side. always start consumers paused. client
    // will request media to resume when the connection completes
    //
    this.producers.forEach((pr) => {
      console.log(pr.appData);
    });
    const producer = this.producers.find(
      (p) => p.appData.mediaTag === mediaTag && p.appData.peerId === this.id,
    );
    if (!producer) {
      const msg = `server-side producer for ${mediaPeerId}:${mediaTag} not found`;
      throw Error(`recv-track: ${msg}`);
    }
    if (!this.room.router.canConsume({
      producerId: producer.id, rtpCapabilities,
    })) {
      const msg = `client cannot consume ${mediaPeerId}:${mediaTag}`;
      throw Error(`recv-track: ${this.id} ${msg}`);
    }

    const transport = Object.values(this.transports).find((t) => t.appData.peerId === this.id && t.appData.clientDirection === 'recv');
    if (!transport) {
      const msg = `server-side recv transport for ${this.id} not found`;
      throw Error(`recv-track: ${msg}`);
    }
    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: true, // see note above about always starting paused
      appData: { peerId: this.id, mediaPeerId, mediaTag },
    });
    consumer.on('transportclose', () => {
      console.log('consumer\'s transport closed', consumer.id);
      this.closeConsumerObject(consumer);
    });
    consumer.on('producerclose', () => {
      console.log('consumer\'s producer closed', consumer.id);
      this.closeConsumerObject((consumer));
    });
    this.consumers.push(consumer);
    this.consumerLayers[consumer.id] = {
      currentLayer: null, clientSelectedLayer: null,
    };
    consumer.on('layerschange', (layers) => {
      console.log(`consumer layerschange ${mediaPeerId}->${this.id}`, mediaTag, layers);
      if (this.consumerLayers[consumer.id]) {
        this.consumerLayers[consumer.id].currentLayer = layers && layers.spatialLayer;
      }
    });
    return {
      producerId: producer.id,
      id: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      producerPaused: consumer.producerPaused,
    };
  }
}

module.exports = Peer;
