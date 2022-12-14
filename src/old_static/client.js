import * as mediasoup from 'mediasoup-client';
import deepEqual from 'deep-equal';
import debugModule from 'debug';

const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);
const log = debugModule('demo-app');
const warn = debugModule('demo-app:WARN');
const err = debugModule('demo-app:ERROR');

//
// export all the references we use internally to manage call state,
// to make it easy to tinker from the js console. for example:
//
//   `Client.camVideoProducer.paused`
//
export const myPeerId = uuidv4();
export let device;
export let joined;
export let localCam;
export let localScreen;
export let recvTransport;
export let sendTransport;
export let camVideoProducer;
export let camAudioProducer;
export let screenVideoProducer;
export let screenAudioProducer;
export let currentActiveSpeaker = {};
export let lastPollSyncData = {};
export let consumers = [];
export let pollingInterval;
export let roomId;

//
// our "signaling" function -- just an http fetch
//

async function sig(endpoint, data, beacon, peerId = myPeerId) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify({ ...data, peerId, roomId });

    if (beacon) {
      navigator.sendBeacon(`/signaling/${endpoint}`, body);
      return null;
    }
    const response = await fetch(`/signaling/${endpoint}`, { method: 'POST', body, headers });
    return await response.json();
  } catch (e) {
    console.error(e);
    return { error: e };
  }
}

//
// entry point -- called by document.body.onload
//

export async function main() {
  console.log(`starting up ... my peerId is ${myPeerId}`);
  const id = window.location.pathname.replaceAll('/', '');
  roomId = id;
  console.log(roomId);
  try {
    device = new mediasoup.Device();
  } catch (e) {
    if (e.name === 'UnsupportedError') {
      console.error('browser not supported for video calls');
      return;
    }
    console.error(e);
  }

  // use sendBeacon to tell the server we're disconnecting when
  // the page unloads
  window.addEventListener('unload', () => sig('leave', {}, true));
}

//
// meeting control actions
//

export async function joinRoom() {
  if (joined) {
    return;
  }

  log('join room');
  $('#join-control').style.display = 'none';

  try {
    // signal that we're a new peer and initialize our
    // mediasoup-client device, if this is our first time connecting
    const { routerRtpCapabilities } = await sig('join');
    if (!device.loaded) {
      await device.load({ routerRtpCapabilities });
    }
    joined = true;
    $('#leave-room').style.display = 'initial';
  } catch (e) {
    console.error(e);
    return;
  }

  // super-simple signaling: let's poll at 1-second intervals
  pollingInterval = setInterval(async () => {
    const { error } = await pollAndUpdate();
    if (error) {
      clearInterval(pollingInterval);
      err(error);
    }
  }, 1000);
}

export async function sendCameraStreams() {
  log('send camera streams');
  $('#send-camera').style.display = 'none';

  // make sure we've joined the room and started our camera. these
  // functions don't do anything if they've already been called this
  // session
  await joinRoom();
  await startCamera();

  // create a transport for outgoing media, if we don't already have one
  if (!sendTransport) {
    sendTransport = await createTransport('send');
  }

  // start sending video. the transport logic will initiate a
  // signaling conversation with the server to set up an outbound rtp
  // stream for the camera video track. our createTransport() function
  // includes logic to tell the server to start the stream in a paused
  // state, if the checkbox in our UI is unchecked. so as soon as we
  // have a client-side camVideoProducer object, we need to set it to
  // paused as appropriate, too.
  camVideoProducer = await sendTransport.produce({
    track: localCam.getVideoTracks()[0],
    encodings: camEncodings(),
    appData: { mediaTag: 'cam-video' },
  });
  if (getCamPausedState()) {
    try {
      await camVideoProducer.pause();
    } catch (e) {
      console.error(e);
    }
  }

  // same thing for audio, but we can use our already-created
  camAudioProducer = await sendTransport.produce({
    track: localCam.getAudioTracks()[0],
    appData: { mediaTag: 'cam-audio' },
  });
  if (getMicPausedState()) {
    try {
      camAudioProducer.pause();
    } catch (e) {
      console.error(e);
    }
  }

  $('#stop-streams').style.display = 'initial';
  showCameraInfo();
}

export async function startScreenshare() {
  log('start screen share');
  $('#share-screen').style.display = 'none';

  // make sure we've joined the room and that we have a sending
  // transport
  await joinRoom();
  if (!sendTransport) {
    sendTransport = await createTransport('send');
  }

  // get a screen share track
  localScreen = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });

  // create a producer for video
  screenVideoProducer = await sendTransport.produce({
    track: localScreen.getVideoTracks()[0],
    encodings: screenshareEncodings(),
    appData: { mediaTag: 'screen-video' },
  });

  // create a producer for audio, if we have it
  if (localScreen.getAudioTracks().length) {
    screenAudioProducer = await sendTransport.produce({
      track: localScreen.getAudioTracks()[0],
      appData: { mediaTag: 'screen-audio' },
    });
  }

  // handler for screen share stopped event (triggered by the
  // browser's built-in screen sharing ui)
  screenVideoProducer.track.onended = async () => {
    log('screen share stopped');
    try {
      await screenVideoProducer.pause();
      const { error } = await sig(
        'close-producer',
        { producerId: screenVideoProducer.id },
      );
      await screenVideoProducer.close();
      screenVideoProducer = null;
      if (error) {
        err(error);
      }
      if (screenAudioProducer) {
        const { error } = await sig(
          'close-producer',
          { producerId: screenAudioProducer.id },
        );
        await screenAudioProducer.close();
        screenAudioProducer = null;
        if (error) {
          err(error);
        }
      }
    } catch (e) {
      console.error(e);
    }
    $('#local-screen-pause-ctrl').style.display = 'none';
    $('#local-screen-audio-pause-ctrl').style.display = 'none';
    $('#share-screen').style.display = 'initial';
  };

  $('#local-screen-pause-ctrl').style.display = 'block';
  if (screenAudioProducer) {
    $('#local-screen-audio-pause-ctrl').style.display = 'block';
  }
}

export async function startCamera() {
  if (localCam) {
    return;
  }
  log('start camera');
  try {
    localCam = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
  } catch (e) {
    console.error('start camera error', e);
  }
}

// switch to sending video from the "next" camera device in our device
// list (if we have multiple cameras)
export async function cycleCamera() {
  if (!(camVideoProducer && camVideoProducer.track)) {
    warn('cannot cycle camera - no current camera track');
    return;
  }

  log('cycle camera');

  // find "next" device in device list
  const deviceId = await getCurrentDeviceId();
  const allDevices = await navigator.mediaDevices.enumerateDevices();
  const vidDevices = allDevices.filter((d) => d.kind === 'videoinput');
  if (!vidDevices.length > 1) {
    warn('cannot cycle camera - only one camera');
    return;
  }
  let idx = vidDevices.findIndex((d) => d.deviceId === deviceId);
  if (idx === (vidDevices.length - 1)) {
    idx = 0;
  } else {
    idx += 1;
  }

  // get a new video stream. might as well get a new audio stream too,
  // just in case browsers want to group audio/video streams together
  // from the same device when possible (though they don't seem to,
  // currently)
  log('getting a video stream from new device', vidDevices[idx].label);
  localCam = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: vidDevices[idx].deviceId } },
    audio: true,
  });

  // replace the tracks we are sending
  await camVideoProducer.replaceTrack({ track: localCam.getVideoTracks()[0] });
  await camAudioProducer.replaceTrack({ track: localCam.getAudioTracks()[0] });

  // update the user interface
  showCameraInfo();
}

export async function stopStreams() {
  if (!(localCam || localScreen)) {
    return;
  }
  if (!sendTransport) {
    return;
  }

  log('stop sending media streams');
  $('#stop-streams').style.display = 'none';

  const { error } = await sig(
    'close-transport',
    { transportId: sendTransport.id },
  );
  if (error) {
    err(error);
  }
  // closing the sendTransport closes all associated producers. when
  // the camVideoProducer and camAudioProducer are closed,
  // mediasoup-client stops the local cam tracks, so we don't need to
  // do anything except set all our local variables to null.
  try {
    await sendTransport.close();
  } catch (e) {
    console.error(e);
  }
  sendTransport = null;
  camVideoProducer = null;
  camAudioProducer = null;
  screenVideoProducer = null;
  screenAudioProducer = null;
  localCam = null;
  localScreen = null;

  // update relevant ui elements
  $('#send-camera').style.display = 'initial';
  $('#share-screen').style.display = 'initial';
  $('#local-screen-pause-ctrl').style.display = 'none';
  $('#local-screen-audio-pause-ctrl').style.display = 'none';
  showCameraInfo();
}

export async function leaveRoom() {
  if (!joined) {
    return;
  }

  log('leave room');
  $('#leave-room').style.display = 'none';

  // stop polling
  clearInterval(pollingInterval);

  // close everything on the server-side (transports, producers, consumers)
  const { error } = await sig('leave');
  if (error) {
    err(error);
  }

  // closing the transports closes all producers and consumers. we
  // don't need to do anything beyond closing the transports, except
  // to set all our local variables to their initial states
  try {
    recvTransport && await recvTransport.close();
    sendTransport && await sendTransport.close();
  } catch (e) {
    console.error(e);
  }
  recvTransport = null;
  sendTransport = null;
  camVideoProducer = null;
  camAudioProducer = null;
  screenVideoProducer = null;
  screenAudioProducer = null;
  localCam = null;
  localScreen = null;
  lastPollSyncData = {};
  consumers = [];
  joined = false;

  // hacktastically restore ui to initial state
  $('#join-control').style.display = 'initial';
  $('#send-camera').style.display = 'initial';
  $('#stop-streams').style.display = 'none';
  $('#remote-video').innerHTML = '';
  $('#share-screen').style.display = 'initial';
  $('#local-screen-pause-ctrl').style.display = 'none';
  $('#local-screen-audio-pause-ctrl').style.display = 'none';
  showCameraInfo();
  updateCamVideoProducerStatsDisplay();
  updateScreenVideoProducerStatsDisplay();
  updatePeersDisplay();
}

export async function subscribeToTrack(peerId, mediaTag) {
  log('subscribe to track', peerId, mediaTag);

  // create a receive transport if we don't already have one
  if (!recvTransport) {
    console.log('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    recvTransport = await createTransport('recv');
  }

  // if we do already have a consumer, we shouldn't have called this
  // method
  let consumer = findConsumerForTrack(peerId, mediaTag);
  if (consumer) {
    err('already have consumer for track', peerId, mediaTag);
    return;
  }

  // ask the server to create a server-side consumer object and send
  // us back the info we need to create a client-side consumer
  const consumerParameters = await sig('recv-track', {
    mediaTag,
    mediaPeerId: peerId,
    rtpCapabilities: device.rtpCapabilities,
  });
  log('consumer parameters', consumerParameters);
  consumer = await recvTransport.consume({
    ...consumerParameters,
    appData: { peerId, mediaTag },
  });
  log('created new consumer', consumer.id);

  // the server-side consumer will be started in paused state. wait
  // until we're connected, then send a resume request to the server
  // to get our first keyframe and start displaying video
  while (recvTransport.connectionState !== 'connected') {
    log('  transport connstate', recvTransport.connectionState);
    await sleep(100);
  }
  // okay, we're ready. let's ask the peer to send us media
  await resumeConsumer(consumer);

  // keep track of all our consumers
  consumers.push(consumer);

  // ui
  await addVideoAudio(consumer);
  updatePeersDisplay();
}

export async function unsubscribeFromTrack(peerId, mediaTag) {
  const consumer = findConsumerForTrack(peerId, mediaTag);
  if (!consumer) {
    return;
  }

  log('unsubscribe from track', peerId, mediaTag);
  try {
    await closeConsumer(consumer);
  } catch (e) {
    console.error(e);
  }
  // force update of ui
  updatePeersDisplay();
}

export async function pauseConsumer(consumer) {
  if (consumer) {
    log('pause consumer', consumer.appData.peerId, consumer.appData.mediaTag);
    try {
      await sig('pause-consumer', { consumerId: consumer.id });
      await consumer.pause();
    } catch (e) {
      console.error(e);
    }
  }
}

export async function resumeConsumer(consumer) {
  if (consumer) {
    log('resume consumer', consumer.appData.peerId, consumer.appData.mediaTag);
    try {
      await sig('resume-consumer', { consumerId: consumer.id });
      await consumer.resume();
    } catch (e) {
      console.error(e);
    }
  }
}

export async function pauseProducer(producer) {
  if (producer) {
    log('pause producer', producer.appData.mediaTag);
    try {
      await sig('pause-producer', { producerId: producer.id });
      await producer.pause();
    } catch (e) {
      console.error(e);
    }
  }
}

export async function resumeProducer(producer) {
  if (producer) {
    log('resume producer', producer.appData.mediaTag);
    try {
      await sig('resume-producer', { producerId: producer.id });
      await producer.resume();
    } catch (e) {
      console.error(e);
    }
  }
}

async function closeConsumer(consumer) {
  if (!consumer) {
    return;
  }
  log('closing consumer', consumer.appData.peerId, consumer.appData.mediaTag);
  try {
    // tell the server we're closing this consumer. (the server-side
    // consumer may have been closed already, but that's okay.)
    await sig('close-consumer', { consumerId: consumer.id });
    await consumer.close();

    consumers = consumers.filter((c) => c !== consumer);
    removeVideoAudio(consumer);
  } catch (e) {
    console.error(e);
  }
}

// utility function to create a transport and hook up signaling logic
// appropriate to the transport's direction
//

//
// polling/update logic
//

async function pollAndUpdate() {
  const { peers, activeSpeaker, error } = await sig('sync');
  if (error) {
    return ({ error });
  }
  console.log(peers);
  console.log(activeSpeaker);

  // always update bandwidth stats and active speaker display
  currentActiveSpeaker = activeSpeaker;
  updateActiveSpeaker();
  updateCamVideoProducerStatsDisplay();
  updateScreenVideoProducerStatsDisplay();
  updateConsumersStatsDisplay();

  // decide if we need to update tracks list and video/audio
  // elements. build list of peers, sorted by join time, removing last
  // seen time and stats, so we can easily do a deep-equals
  // comparison. compare this list with the cached list from last
  // poll.
  const thisPeersList = sortPeers(peers);
  const lastPeersList = sortPeers(lastPollSyncData);
  if (!deepEqual(thisPeersList, lastPeersList)) {
    updatePeersDisplay(peers, thisPeersList);
  }

  // if a peer has gone away, we need to close all consumers we have
  // for that peer and remove video and audio elements
  for (const id in lastPollSyncData) {
    if (!peers[id]) {
      log(`peer ${id} has exited`);
      consumers.forEach((consumer) => {
        if (consumer.appData.peerId === id) {
          closeConsumer(consumer);
        }
      });
    }
  }

  // if a peer has stopped sending media that we are consuming, we
  // need to close the consumer and remove video and audio elements
  consumers.forEach((consumer) => {
    const { peerId, mediaTag } = consumer.appData;
    if (!peers[peerId].media[mediaTag]) {
      log(`peer ${peerId} has stopped transmitting ${mediaTag}`);
      closeConsumer(consumer);
    }
  });

  lastPollSyncData = peers;
  return ({}); // return an empty object if there isn't an error
}

function sortPeers(peers) {
  return Object.entries(peers)
    .map(([id, info]) => ({ id, joinTs: info.joinTs, media: { ...info.media } }))
    .sort((a, b) => ((a.joinTs > b.joinTs) ? 1 : ((b.joinTs > a.joinTs) ? -1 : 0)));
}

function findConsumerForTrack(peerId, mediaTag) {
  return consumers.find((c) => (c.appData.peerId === peerId
                                && c.appData.mediaTag === mediaTag));
}

//
// -- user interface --
//

export function getCamPausedState() {
  return !$('#local-cam-checkbox').checked;
}

export function getMicPausedState() {
  return !$('#local-mic-checkbox').checked;
}

export function getScreenPausedState() {
  return !$('#local-screen-checkbox').checked;
}

export function getScreenAudioPausedState() {
  return !$('#local-screen-audio-checkbox').checked;
}

export async function changeCamPaused() {
  if (getCamPausedState()) {
    pauseProducer(camVideoProducer);
    $('#local-cam-label').innerHTML = 'camera (paused)';
  } else {
    resumeProducer(camVideoProducer);
    $('#local-cam-label').innerHTML = 'camera';
  }
}

export async function changeMicPaused() {
  if (getMicPausedState()) {
    pauseProducer(camAudioProducer);
    $('#local-mic-label').innerHTML = 'mic (paused)';
  } else {
    resumeProducer(camAudioProducer);
    $('#local-mic-label').innerHTML = 'mic';
  }
}

export async function changeScreenPaused() {
  if (getScreenPausedState()) {
    pauseProducer(screenVideoProducer);
    $('#local-screen-label').innerHTML = 'screen (paused)';
  } else {
    resumeProducer(screenVideoProducer);
    $('#local-screen-label').innerHTML = 'screen';
  }
}

export async function changeScreenAudioPaused() {
  if (getScreenAudioPausedState()) {
    pauseProducer(screenAudioProducer);
    $('#local-screen-audio-label').innerHTML = 'screen (paused)';
  } else {
    resumeProducer(screenAudioProducer);
    $('#local-screen-audio-label').innerHTML = 'screen';
  }
}

export async function updatePeersDisplay(
  peersInfo = lastPollSyncData,
  sortedPeers = sortPeers(peersInfo),
) {
  log('room state updated', peersInfo);

  $('#available-tracks').innerHTML = '';
  if (camVideoProducer) {
    $('#available-tracks')
      .appendChild(makeTrackControlEl(
        'my',
        'cam-video',
        peersInfo[myPeerId].media['cam-video'],
      ));
  }
  if (camAudioProducer) {
    $('#available-tracks')
      .appendChild(makeTrackControlEl(
        'my',
        'cam-audio',
        peersInfo[myPeerId].media['cam-audio'],
      ));
  }
  if (screenVideoProducer) {
    $('#available-tracks')
      .appendChild(makeTrackControlEl(
        'my',
        'screen-video',
        peersInfo[myPeerId].media['screen-video'],
      ));
  }
  if (screenAudioProducer) {
    $('#available-tracks')
      .appendChild(makeTrackControlEl(
        'my',
        'screen-audio',
        peersInfo[myPeerId].media['screen-audio'],
      ));
  }

  for (const peer of sortedPeers) {
    if (peer.id === myPeerId) {
      continue;
    }
    for (const [mediaTag, info] of Object.entries(peer.media)) {
      $('#available-tracks')
        .appendChild(makeTrackControlEl(peer.id, mediaTag, info));
    }
  }
}

function makeTrackControlEl(peerName, mediaTag, mediaInfo) {
  const div = document.createElement('div');
  const peerId = (peerName === 'my' ? myPeerId : peerName);
  const consumer = findConsumerForTrack(peerId, mediaTag);
  div.classList = `track-subscribe track-subscribe-${peerId}`;

  const sub = document.createElement('button');
  if (!consumer) {
    sub.innerHTML += 'subscribe';
    sub.onclick = () => subscribeToTrack(peerId, mediaTag);
    div.appendChild(sub);
  } else {
    sub.innerHTML += 'unsubscribe';
    sub.onclick = () => unsubscribeFromTrack(peerId, mediaTag);
    div.appendChild(sub);
  }

  const trackDescription = document.createElement('span');
  trackDescription.innerHTML = `${peerName} ${mediaTag}`;
  div.appendChild(trackDescription);

  try {
    if (mediaInfo) {
      const producerPaused = mediaInfo.paused;
      const prodPauseInfo = document.createElement('span');
      prodPauseInfo.innerHTML = producerPaused ? '[producer paused]'
        : '[producer playing]';
      div.appendChild(prodPauseInfo);
    }
  } catch (e) {
    console.error(e);
  }

  if (consumer) {
    const pause = document.createElement('span');
    const checkbox = document.createElement('input');
    const label = document.createElement('label');
    pause.classList = 'nowrap';
    checkbox.type = 'checkbox';
    checkbox.checked = !consumer.paused;
    checkbox.onchange = async () => {
      if (checkbox.checked) {
        await resumeConsumer(consumer);
      } else {
        await pauseConsumer(consumer);
      }
      updatePeersDisplay();
    };
    label.id = `consumer-stats-${consumer.id}`;
    if (consumer.paused) {
      label.innerHTML = '[consumer paused]';
    } else {
      const stats = lastPollSyncData[myPeerId].stats[consumer.id];
      let bitrate = '-';
      if (stats) {
        bitrate = Math.floor(stats.bitrate / 1000.0);
      }
      label.innerHTML = `[consumer playing ${bitrate} kb/s]`;
    }
    pause.appendChild(checkbox);
    pause.appendChild(label);
    div.appendChild(pause);

    if (consumer.kind === 'video') {
      const remoteProducerInfo = document.createElement('span');
      remoteProducerInfo.classList = 'nowrap track-ctrl';
      remoteProducerInfo.id = `track-ctrl-${consumer.producerId}`;
      div.appendChild(remoteProducerInfo);
    }
  }

  return div;
}

function addVideoAudio(consumer) {
  if (!(consumer && consumer.track)) {
    return;
  }
  const el = document.createElement(consumer.kind);
  // set some attributes on our audio and video elements to make
  // mobile Safari happy. note that for audio to play you need to be
  // capturing from the mic/camera
  if (consumer.kind === 'video') {
    el.setAttribute('playsinline', true);
  } else {
    el.setAttribute('playsinline', true);
    el.setAttribute('autoplay', true);
  }
  $(`#remote-${consumer.kind}`).appendChild(el);
  el.srcObject = new MediaStream([consumer.track.clone()]);
  el.consumer = consumer;
  // let's "yield" and return before playing, rather than awaiting on
  // play() succeeding. play() will not succeed on a producer-paused
  // track until the producer unpauses.
  el.play()
    .then(() => {})
    .catch((e) => {
      err(e);
    });
}

function removeVideoAudio(consumer) {
  document.querySelectorAll(consumer.kind).forEach((v) => {
    if (v.consumer === consumer) {
      v.parentNode.removeChild(v);
    }
  });
}

async function showCameraInfo() {
  const deviceId = await getCurrentDeviceId();
  const infoEl = $('#camera-info');
  if (!deviceId) {
    infoEl.innerHTML = '';
    return;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const deviceInfo = devices.find((d) => d.deviceId === deviceId);
  infoEl.innerHTML = `
      ${deviceInfo.label}
      <button onclick="Client.cycleCamera()">switch camera</button>
  `;
}

export async function getCurrentDeviceId() {
  if (!camVideoProducer) {
    return null;
  }
  const { deviceId } = camVideoProducer.track.getSettings();
  if (deviceId) {
    return deviceId;
  }
  // Firefox doesn't have deviceId in MediaTrackSettings object
  const track = localCam && localCam.getVideoTracks()[0];
  if (!track) {
    return null;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const deviceInfo = devices.find((d) => d.label.startsWith(track.label));
  return deviceInfo.deviceId;
}

function updateActiveSpeaker() {
  $$('.track-subscribe').forEach((el) => {
    el.classList.remove('active-speaker');
  });
  if (currentActiveSpeaker.peerId) {
    $$(`.track-subscribe-${currentActiveSpeaker.peerId}`).forEach((el) => {
      el.classList.add('active-speaker');
    });
  }
}

function updateCamVideoProducerStatsDisplay() {
  const tracksEl = $('#camera-producer-stats');
  tracksEl.innerHTML = '';
  if (!camVideoProducer || camVideoProducer.paused) {
    return;
  }
  makeProducerTrackSelector({
    internalTag: 'local-cam-tracks',
    container: tracksEl,
    peerId: myPeerId,
    producerId: camVideoProducer.id,
    currentLayer: camVideoProducer.maxSpatialLayer,
    layerSwitchFunc: (i) => {
      console.log('client set layers for cam stream');
      camVideoProducer.setMaxSpatialLayer(i);
    },
  });
}

function updateScreenVideoProducerStatsDisplay() {
  const tracksEl = $('#screen-producer-stats');
  tracksEl.innerHTML = '';
  if (!screenVideoProducer || screenVideoProducer.paused) {
    return;
  }
  makeProducerTrackSelector({
    internalTag: 'local-screen-tracks',
    container: tracksEl,
    peerId: myPeerId,
    producerId: screenVideoProducer.id,
    currentLayer: screenVideoProducer.maxSpatialLayer,
    layerSwitchFunc: (i) => {
      console.log('client set layers for screen stream');
      screenVideoProducer.setMaxSpatialLayer(i);
    },
  });
}

function updateConsumersStatsDisplay() {
  try {
    for (const consumer of consumers) {
      const label = $(`#consumer-stats-${consumer.id}`);
      if (label) {
        if (consumer.paused) {
          label.innerHTML = '(consumer paused)';
        } else {
          const stats = lastPollSyncData[myPeerId].stats[consumer.id];
          let bitrate = '-';
          if (stats) {
            bitrate = Math.floor(stats.bitrate / 1000.0);
          }
          label.innerHTML = `[consumer playing ${bitrate} kb/s]`;
        }
      }

      const mediaInfo = lastPollSyncData[consumer.appData.peerId]
                      && lastPollSyncData[consumer.appData.peerId]
                        .media[consumer.appData.mediaTag];
      if (mediaInfo && !mediaInfo.paused) {
        const tracksEl = $(`#track-ctrl-${consumer.producerId}`);
        if (tracksEl && lastPollSyncData[myPeerId]
          .consumerLayers[consumer.id]) {
          tracksEl.innerHTML = '';
          const { currentLayer } = lastPollSyncData[myPeerId]
            .consumerLayers[consumer.id];
          makeProducerTrackSelector({
            internalTag: consumer.id,
            container: tracksEl,
            peerId: consumer.appData.peerId,
            producerId: consumer.producerId,
            currentLayer,
            layerSwitchFunc: (i) => {
              console.log('ask server to set layers');
              sig('consumer-set-layers', {
                consumerId: consumer.id,
                spatialLayer: i,
              });
            },
          });
        }
      }
    }
  } catch (e) {
    log('error while updating consumers stats display', e);
  }
}

function makeProducerTrackSelector({
  internalTag, container, peerId, producerId,
  currentLayer, layerSwitchFunc,
}) {
  try {
    const pollStats = lastPollSyncData[peerId]
                    && lastPollSyncData[peerId].stats[producerId];
    if (!pollStats) {
      return;
    }

    const stats = [...Array.from(pollStats)]
      .sort((a, b) => (a.rid > b.rid ? 1 : (a.rid < b.rid ? -1 : 0)));
    let i = 0;
    for (const s of stats) {
      const div = document.createElement('div');
      const radio = document.createElement('input');
      const label = document.createElement('label');
      const x = i;
      radio.type = 'radio';
      radio.name = `radio-${internalTag}-${producerId}`;
      radio.checked = currentLayer == undefined
        ? (i === stats.length - 1)
        : (i === currentLayer);
      radio.onchange = () => layerSwitchFunc(x);
      const bitrate = Math.floor(s.bitrate / 1000);
      label.innerHTML = `${bitrate} kb/s`;
      div.appendChild(radio);
      div.appendChild(label);
      container.appendChild(div);
      i++;
    }
    if (i) {
      const txt = document.createElement('div');
      txt.innerHTML = 'tracks';
      container.insertBefore(txt, container.firstChild);
    }
  } catch (e) {
    log('error while updating track stats display', e);
  }
}

//
// encodings for outgoing video
//

// just two resolutions, for now, as chrome 75 seems to ignore more
// than two encodings
//
const CAM_VIDEO_SIMULCAST_ENCODINGS = [
  { maxBitrate: 96000, scaleResolutionDownBy: 4 },
  { maxBitrate: 680000, scaleResolutionDownBy: 1 },
];

function camEncodings() {
  return CAM_VIDEO_SIMULCAST_ENCODINGS;
}

// how do we limit bandwidth for screen share streams?
//
function screenshareEncodings() {
  null;
}

//
// simple uuid helper function
//

function uuidv4() {
  return ('111-111-1111').replace(/[018]/g, () => (crypto.getRandomValues(new Uint8Array(1))[0] & 15).toString(16));
}

//
// promisified sleep
//

async function sleep(ms) {
  return new Promise((r) => setTimeout(() => r(), ms));
}
