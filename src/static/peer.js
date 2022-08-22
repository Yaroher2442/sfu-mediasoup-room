export class Peer {
  // peerId;
  //
  // joinedToRoom = false;
  //
  // isActiveSpeaker;
  //
  // apiClient;

  // pausesState = {
  //   camera: true, mic: true, screen: true, screenMic: true,
  // };

  constructor(apiClient, peerId) {
    this.apiClient = apiClient;
    this.peerId = peerId;
    this.isActiveSpeaker = false;
    this.joinedToRoom = true;
    this.pausesState = {
      camera: true, mic: true, screen: true, screenMic: true,
    };
  }

  set micEnable(value) {
    this.pausesState.mic = value;
  }

  set camEnable(value) {
    this.pausesState.camera = value;
  }

  set screenEnable(value) {
    this.pausesState.screen = value;
  }

  set screenMicEnable(value) {
    this.pausesState.screenMic = value;
  }
}

export class RemotePeer extends Peer {
  // consumers;

  constructor(apiClient, peerId) {
    super(apiClient, peerId);
    this.consumers = [];
  }

  async subscribeToTrack(receiveTransport, rtpCapabilities, mediaTag) {
    console.log('subscribe to track', this.peerId, mediaTag);

    // if we do already have a consumer, we shouldn't have called this
    // method
    let consumer = consumers.find((c) => (c.appData.mediaTag === mediaTag));
    if (consumer) {
      console.error(('already have consumer for track', this.peerId, mediaTag));
      return;
    }

    // ask the server to create a server-side consumer object and send
    // us back the info we need to create a client-side consumer
    const consumerParameters = await this.apiClient.sendSignal('recv-track', {
      mediaTag,
      mediaPeerId: this.peerId,
      rtpCapabilities,
    });
    console.log('consumer parameters', consumerParameters);
    consumer = await receiveTransport.consume({
      ...consumerParameters,
      appData: { peerId: this.peerId, mediaTag },
    });
    console.log('created new consumer', consumer.id);

    // the server-side consumer will be started in paused state. wait
    // until we're connected, then send a resume request to the server
    // to get our first keyframe and start displaying video
    while (receiveTransport.connectionState !== 'connected') {
      console.log('  transport connstate', receiveTransport.connectionState);
      await Promise((r) => setTimeout(() => r(), 100));
    }
    // okay, we're ready. let's ask the peer to send us media
    if (consumer) {
      console.log('resume consumer', consumer.appData.peerId, consumer.appData.mediaTag);
      try {
        await this.apiClient.sendSignal('resume-consumer', { consumerId: consumer.id });
        await consumer.resume();
      } catch (e) {
        console.error(e);
      }
    }
    // keep track of all our consumers
    this.consumers.push(consumer);
  }

  async unsubscribeFromTrack(mediaTag) {
    const consumer = consumers.find((c) => (c.appData.mediaTag === mediaTag));
    if (!consumer) {
      return;
    }
    console.log('unsubscribe from track', this.peerId, mediaTag);
    try {
      if (!consumer) {
        return;
      }
      console.log('closing consumer', consumer.appData.peerId, consumer.appData.mediaTag);
      try {
        // tell the server we're closing this consumer. (the server-side
        // consumer may have been closed already, but that's okay.)
        await this.apiClient.sendSignal('close-consumer', { consumerId: consumer.id });
        await consumer.close();

        this.consumers = this.consumers.filter((c) => c !== consumer);
      } catch (e) {
        console.error(e);
      }
    } catch (e) {
      console.error(e);
    }
  }
}

export class LocalPeer extends Peer {
  // camVideoProducer;
  //
  // camAudioProducer;
  //
  // localCam;

  constructor(apiClient, peerId, { cameraPause, micPause }) {
    super(apiClient, peerId);
    this.joinedToRoom = false;
    this.pausesState.camera = cameraPause;
    this.pausesState.mic = micPause;
  }

  async createLocalCam() {
    if (!this.localCam) {
      try {
        this.localCam = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
      } catch (e) {
        console.error('start camera error', e);
      }
    }
  }

  async sendLocalMedia(sendTransport) {
    await this.createLocalCam();
    if (!sendTransport) {
      throw Error('Need transport to send');
    }
    const camEncodes = [
      { maxBitrate: 96000, scaleResolutionDownBy: 4 },
      { maxBitrate: 680000, scaleResolutionDownBy: 1 },
    ];
    this.camVideoProducer = await sendTransport.produce({
      track: this.localCam.getVideoTracks()[0],
      encodings: camEncodes,
      appData: { mediaTag: 'cam-video' },
    });
    if (this.pausesState.camera) {
      try {
        await this.camVideoProducer.pause();
      } catch (e) {
        console.error(e);
      }
    }
    this.camAudioProducer = await sendTransport.produce({
      track: this.localCam.getAudioTracks()[0],
      appData: { mediaTag: 'cam-audio' },
    });
    if (this.pausesState.mic) {
      try {
        await this.camAudioProducer.pause();
      } catch (e) {
        console.error(e);
      }
    }
  }
}
