(function (namespace) {
  "use strict";

  class VideoController {
    constructor(videoElement, callbacks) {
      this.video = videoElement;
      this.callbacks = callbacks || {};
      this.objectUrl = null;
      this.sourceLoaded = false;
      this.duration = 0;
      this.rangeEnd = null;
      this.animationFrame = null;
      this.bindEvents();
    }

    bindEvents() {
      this.video.addEventListener("loadedmetadata", () => {
        const duration = Number(this.video.duration);
        if (!Number.isFinite(duration) || duration <= 0) {
          this.emit("onError", "无法读取视频时长，请尝试其他视频格式。");
          return;
        }
        this.duration = duration;
        this.emit("onDuration", duration);
        this.emitTime();
      });

      this.video.addEventListener("durationchange", () => {
        const duration = Number(this.video.duration);
        if (Number.isFinite(duration) && duration > 0 && duration !== this.duration) {
          this.duration = duration;
          this.emit("onDuration", duration);
        }
      });

      this.video.addEventListener("play", () => this.startClock());
      this.video.addEventListener("pause", () => {
        this.stopClock();
        this.emitTime();
      });
      this.video.addEventListener("seeking", () => this.emitTime());
      this.video.addEventListener("timeupdate", () => this.emitTime());
      this.video.addEventListener("ended", () => {
        this.rangeEnd = null;
        this.stopClock();
        this.emitTime();
      });
      this.video.addEventListener("error", () => {
        const mediaError = this.video.error;
        const details = mediaError && mediaError.code === 4
          ? "浏览器不支持该视频编码或格式。建议使用 H.264/AAC 编码的 MP4。"
          : "视频无法加载或播放，请检查文件是否有效。";
        this.emit("onError", details);
      });
    }

    emit(name, value) {
      if (typeof this.callbacks[name] === "function") this.callbacks[name](value);
    }

    emitTime() {
      const current = Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0;
      if (this.rangeEnd !== null && current >= this.rangeEnd - 0.005) {
        this.video.pause();
        this.video.currentTime = this.rangeEnd;
        this.rangeEnd = null;
      }
      this.emit("onTime", this.video.currentTime || 0);
    }

    startClock() {
      this.stopClock();
      const tick = () => {
        this.emitTime();
        if (!this.video.paused && !this.video.ended) {
          this.animationFrame = requestAnimationFrame(tick);
        }
      };
      this.animationFrame = requestAnimationFrame(tick);
    }

    stopClock() {
      if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    loadFile(file) {
      if (!file) return;
      if (file.type && !file.type.startsWith("video/")) {
        this.emit("onError", "所选文件不是浏览器识别的视频格式。");
        return;
      }
      this.clearSource();
      this.objectUrl = URL.createObjectURL(file);
      this.sourceLoaded = true;
      this.video.src = this.objectUrl;
      this.video.load();
      this.emit("onFile", file);
    }

    clearSource() {
      this.stopClock();
      this.rangeEnd = null;
      this.duration = 0;
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
      this.sourceLoaded = false;
    }

    loadUrl(url) {
      const source = String(url || "").trim();
      if (!source) {
        this.emit("onError", "在线视频地址为空。");
        return false;
      }
      this.clearSource();
      this.sourceLoaded = true;
      this.video.src = source;
      this.video.load();
      return true;
    }

    hasVideo() {
      return this.sourceLoaded;
    }

    seek(time) {
      if (!this.hasVideo() || !Number.isFinite(this.duration) || this.duration <= 0) return false;
      this.rangeEnd = null;
      this.video.currentTime = Math.min(this.duration, Math.max(0, Number(time) || 0));
      this.emitTime();
      return true;
    }

    nudge(delta) {
      return this.seek((this.video.currentTime || 0) + delta);
    }

    togglePlayback() {
      if (!this.hasVideo()) return Promise.reject(new Error("请先加载视频。"));
      this.rangeEnd = null;
      if (this.video.paused) return this.video.play();
      this.video.pause();
      return Promise.resolve();
    }

    playRange(start, end) {
      if (!this.hasVideo()) return Promise.reject(new Error("请先加载视频。"));
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > this.duration + 0.005) {
        return Promise.reject(new Error("播放区间无效或超出视频时长。"));
      }
      this.video.pause();
      this.video.currentTime = start;
      this.rangeEnd = end;
      this.emitTime();
      return this.video.play().catch((error) => {
        this.rangeEnd = null;
        throw error;
      });
    }

    setPlaybackRate(rate) {
      const value = Number(rate);
      if (Number.isFinite(value) && value > 0) this.video.playbackRate = value;
    }

    getCurrentTime() {
      return Number(this.video.currentTime) || 0;
    }
  }

  namespace.VideoController = VideoController;
})(window.FitInteract = window.FitInteract || {});
