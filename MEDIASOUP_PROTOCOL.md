# mediasoup protocol

List of messages (requests/responses/notifications) that must be exchanged between client and server side of the mediasoup based application. No signaling protocol is provided but just message payloads. The application is responsible of sending and receiving these messages.


## From client to server

Messages generated by the client-side `Room` instance that must be given to the corresponding server-side `Room` or `Peer` instance (depending on the `target` field).


### queryRoom

Get info about the server-side `Room`.

Request:

```js
{
  method: 'queryRoom',
  target: 'room'
}
```

Response:

```js
{
  rtpCapabilities: {},
  mandatoryCodecPayloadTypes: []
}
```


### join

Create a server-side `Peer`.
Other peers will be notified with a `newPeer` notification.

Request:

```js
{
  method: 'join',
  target: 'room',
  peerName: 'myname',
  rtpCapabilities: {},
  spy: false,
  appData: Any
}
```

Response:

```js
{
  peers: []
}
```


### leave

Close the server-side `Peer`.
Other peers will be notified with a `peerClosed` notification.

Notification:

```js
{
  method: 'leave',
  target: 'peer',
  notification: true,
  appData: Any
}
```


### createTransport

Create a server-side `Transport`.

Request:

```js
{
  method: 'createTransport',
  target: 'peer',
  id: 1111,
  direction: 'send', // 'send'/'recv'.
  options: {},
  dtlsParameters: {}, // Optional.
  plainRtpParameters: {}, // Optional.
  appData: Any
}
```

Response:

```js
{
  iceParameters: {},
  iceCandidates: [],
  dtlsParameters: {}
}
```


### updateTransport

Provide pending local parameters (if needed) to a server-side `Transport`.

Notification:

```js
{
  method: 'updateTransport',
  target: 'peer',
  notification: true,
  id: 1111,
  dtlsParameters: {}
}
```


### restartTransport

Request the server-side `Transport` to generate new values for its ICE `userFragment` and `password`.

Request:

```js
{
  method: 'restartTransport',
  target: 'peer',
  id: 1111
}
```

Response:

```js
{
  iceParameters: {}
}
```


### closeTransport

Close a server-side `Transport`.

Notification:

```js
{
  method: 'closeTransport',
  target: 'peer',
  notification: true,
  id: 1111,
  appData: Any
}
```


### enableTransportStats

Enable periodic transport stats retrieval.

Notification:

```js
{
  method: 'enableTransportStats',
  id: 3333,
  interval: 1
}
```


### disableTransportStats

Disable periodic transport stats retrieval.

Notification:

```js
{
  method: 'disableTransportStats',
  id: 3333,
}
```


### createProducer

Create a server-side `Producer` for sending media over the indicate `Transport`.
Other peers will be notified with a `newConsumer` notification.

Request:

```js
{
  method: 'createProducer',
  target: 'peer',
  id: 2222,
  kind: 'audio',
  transportId: 1111,
  rtpParameters: {},
  paused: false,
  appData: Any
}
```

Response: (empty)


### updateProducer

Just for libwebrtc based devices (no `replaceTrack()` support).
Indicates that the `Producer` has changed its sending RTP parameters (in fact, just the SSRCs).

Notification:

```js
{
  method: 'updateProducer',
  target: 'peer',
  notification: true,
  id: 2222,
  rtpParameters: {}
}
```


### pauseProducer

Pause a server-side `Producer`.
Other peers will be notified with a `consumerPaused` notification.

Notification:

```js
{
  method: 'pauseProducer',
  target: 'peer',
  notification: true,
  id: 2222,
  appData: Any
}
```


### resumeProducer

Resume a server-side `Producer`.
Other peers will be notified with a `consumerResumed` notification.

Notification:

```js
{
  method: 'resumeProducer',
  target: 'peer',
  notification: true,
  id: 2222,
  appData: Any
}
```


### closeProducer

Close a server-side `Producer`.
Other peers will be notified with a `consumerClosed` notification.

Notification:

```js
{
  method: 'closeProducer',
  target: 'peer',
  notification: true,
  id: 2222,
  appData: Any
}
```


### enableProducerStats

Enable periodic producer stats retrieval.

Notification:

```js
{
  method: 'enableProducerStats',
  id: 3333,
  interval: 1
}
```


### disableProducerStats

Disable periodic producer stats retrieval.

Notification:

```js
{
  method: 'disableProducerStats',
  id: 3333,
}
```


### enableConsumer

Enable the reception of media from a server-side `Consumer`.

Request:

```js
{
  method: 'enableConsumer',
  target: 'peer',
  id: 3333,
  transportId: 9999,
  paused: false,
  preferredProfile: 'low'
}
```

Response:

```js
{
  paused: false,
  preferredProfile: null,
  effectiveProfile: 'default'
}
```


### pauseConsumer

Pause the reception of media from a server-side `Consumer`.

Notification:

```js
{
  method: 'pauseConsumer',
  target: 'peer',
  notification: true,
  id: 3333,
  appData: Any
}
```


### resumeConsumer

Resume the reception of media from a server-side `Consumer`.

Notification:

```js
{
  method: 'resumeConsumer',
  target: 'peer',
  notification: true,
  id: 3333,
  appData: Any
}
```


### setConsumerPreferredProfile

Set the desired receiving profile.

Notification:

```js
{
  method: 'setConsumerPreferredProfile',
  notification: true,
  id: 3333,
  profile: 'high'
}
```


### enableConsumerStats

Enable periodic consumer stats retrieval.

Notification:

```js
{
  method: 'enableConsumerStats',
  id: 3333,
  interval: 1
}
```


### disableConsumerStats

Disable periodic consumer stats retrieval.

Notification:

```js
{
  method: 'disableConsumerStats',
  id: 3333,
}
```


## From server to client

Messages generated by the server-side `Peer` instance that must be given to the client-side `Room` instance.


### closed

The server-side `Room` or my server-side `Peer` has been closed in the server.

Notification:

```js
{
  method: 'closed',
  target: 'peer',
  notification: true,
  appData: Any
}
```


### transportClosed

A server-side `Transport` has been closed in the server.

Notification:

```js
{
  method: 'transportClosed',
  target: 'peer',
  notification: true,
  id: 1111,
  appData: Any
}
```


### transportStats

Transport stats, enabled via `enableTransportStats`.

Notification:

```js
{
  method: 'transportStats',
  target: 'peer',
  notification: true,
  id: 3333,
  stats: []
}
```


### producerPaused

A server-side `Producer` has been paused in the server.

Notification:

```js
{
  method: 'producerPaused',
  target: 'peer',
  notification: true,
  id: 2222,
  appData: Any
}
```


### producerResumed

A server-side `Producer` has been resumed in the server.

Notification:

```js
{
  method: 'producerResumed',
  target: 'peer',
  notification: true,
  id: 2222,
  appData: Any
}
```


### producerClosed

A server-side `Producer` has been closed in the server.

Notification:

```js
{
  method: 'producerClosed',
  target: 'peer',
  notification: true,
  id: 2222,
  appData: Any
}
```


### producerStats

Producer stats, enabled via `enableProducerStats`.

Notification:

```js
{
  method: 'producerStats',
  target: 'peer',
  notification: true,
  id: 3333,
  stats: []
}
```


### newPeer

A new `Peer` has joined the server-side `Room`.

Notification:

```js
{
  method: 'newPeer',
  target: 'peer',
  notification: true,
  name: 'alice',
  consumers:
  [
    {
      id: 5555,
      kind: 'audio',
      rtpParameters: {},
      paused: false,
      appData: Any
    }
  ],
  appData: Any
}
```


### peerClosed

A server-side `Peer` has been closed (it may have left the room or his server-side `Peer` has been closed in the server).

Notification:

```js
{
  method: 'peerClosed',
  target: 'peer',
  notification: true,
  name: 'alice',
  appData: Any
}
```


### newConsumer

A new server-side `Consumer` has been created.

Notification:

```js
{
  method: 'newConsumer',
  target: 'peer',
  notification: true,
  id: 3333,
  kind: 'video',
  peerName: 'alice',
  rtpParameters: {},
  paused: false,
  preferredProfile: 'high',
  effectiveProfile: 'medium',
  appData: Any
}
```


### consumerPaused

A server-side `Consumer` has been paused (its originating `Peer` may have paused it, or his server-side `Producer` may have been paused in the server, or my associated `Consumer` may have been paused in the server).

Notification:

```js
{
  method: 'consumerPaused',
  target: 'peer',
  notification: true,
  id: 3333,
  peerName: 'alice',
  appData: Any
}
```


### consumerResumed

A server-side `Consumer` has been resumed (its originating `Peer` may have resumed it, or his server-side `Producer` may have been resumed in the server, or my associated `Consumer` may have been resumed in the server).

Notification:

```js
{
  method: 'consumerResumed',
  target: 'peer',
  notification: true,
  id: 3333,
  peerName: 'alice',
  appData: Any
}
```


### consumerPreferredProfileSet

A server-side `Consumer` has set its preferred receiving profile.

Notification:

```js
{
  method: 'consumerPreferredProfileSet',
  target: 'peer',
  notification: true,
  id: 3333,
  peerName: 'alice',
  profile: 'medium'
}
```


### consumerEffectiveProfileChanged

The effective receiving profile in a server-side `Consumer` changed.

Notification:

```js
{
  method: 'consumerEffectiveProfileChanged',
  target: 'peer',
  notification: true,
  id: 3333,
  peerName: 'alice',
  profile: 'high'
}
```


### consumerStats

Consumer stats, enabled via `enableConsumerStats`.

Notification:

```js
{
  method: 'consumerStats',
  target: 'peer',
  notification: true,
  id: 3333,
  stats: []
}
```