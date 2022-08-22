import EventEmitter from 'events';
import axios from 'axios';

export default class ApiClient extends EventEmitter {
  // axiosInstance;
  //
  // lastSyncData;

  constructor(signalingUrl, roomId) {
    super();
    this.sse = null;
    this.roomId = roomId;
    this.signalingUrl = signalingUrl;
    this.lastSyncData = {};
    this.axiosInstance = axios.create({
      baseURL: signalingUrl,
      timeout: 1000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async sendSignal(endpoint, data, beacon, peerId = this.peerId) {
    try {
      const resp = await this.axiosInstance.post(`/signaling/${endpoint}`, { ...data, peerId, roomId: this.roomId });
      return resp.data;
    } catch (e) {
      console.error(e);
      return { error: e };
    }
  }

  async createRtConnection() {
    if (!this.es) {
      this.sse = new EventSource('/events');
    }
    this.sse.addEventListener('peerLeave', () => {
      console.log('asfasfasfsaf');
    });
  }

  async closeRtConnection() {
    this.sse.close();
    this.sse = null;
  }
}
