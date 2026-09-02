(function (namespace) {
  "use strict";

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  class TimelineController {
    constructor(elements, callbacks) {
      this.elements = elements;
      this.callbacks = callbacks || {};
      this.duration = 0;
      this.currentTime = 0;
      this.start = null;
      this.end = null;
      this.mode = "annotate";
      this.nextBoundary = "start";
      this.zoom = 1;
      this.dragBoundary = null;
      this.bindEvents();
      this.render();
    }

    bindEvents() {
      this.elements.track.addEventListener("pointerdown", (event) => {
        if (event.target === this.elements.startHandle || event.target === this.elements.endHandle) return;
        if (this.duration <= 0) {
          this.emit("onError", "请先选择并加载本地视频。");
          return;
        }
        const time = this.timeFromPointer(event);
        if (event.shiftKey || this.mode === "annotate") {
          this.applyAnnotationClick(time);
        } else {
          this.emit("onSeek", time);
        }
      });

      this.bindHandle(this.elements.startHandle, "start");
      this.bindHandle(this.elements.endHandle, "end");
    }

    bindHandle(handle, boundary) {
      handle.addEventListener("pointerdown", (event) => {
        if (this.duration <= 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.dragBoundary = boundary;
        handle.setPointerCapture(event.pointerId);
      });

      handle.addEventListener("pointermove", (event) => {
        if (this.dragBoundary !== boundary) return;
        const time = this.timeFromPointer(event);
        if (boundary === "start") {
          this.start = this.end === null ? time : Math.min(time, Math.max(0, this.end - 0.01));
        } else {
          this.end = this.start === null ? time : Math.max(time, Math.min(this.duration, this.start + 0.01));
        }
        this.nextBoundary = boundary === "start" ? "end" : "start";
        this.render();
        this.emitSelection();
        this.emit("onSeek", boundary === "start" ? this.start : this.end);
      });

      const release = (event) => {
        if (this.dragBoundary !== boundary) return;
        this.dragBoundary = null;
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      };
      handle.addEventListener("pointerup", release);
      handle.addEventListener("pointercancel", release);
    }

    emit(name, value) {
      if (typeof this.callbacks[name] === "function") this.callbacks[name](value);
    }

    timeFromPointer(event) {
      const rect = this.elements.track.getBoundingClientRect();
      if (!rect.width) return 0;
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      return ratio * this.duration;
    }

    applyAnnotationClick(time) {
      if (this.nextBoundary === "start" || this.start === null) {
        this.start = time;
        this.end = null;
        this.nextBoundary = "end";
      } else {
        this.end = time;
        if (this.end < this.start) {
          const previousStart = this.start;
          this.start = this.end;
          this.end = previousStart;
        }
        if (Math.abs(this.end - this.start) < 0.005) {
          this.end = Math.min(this.duration, this.start + 0.01);
        }
        this.nextBoundary = "start";
      }
      this.render();
      this.emitSelection();
      this.emit("onSeek", time);
    }

    setDuration(duration) {
      this.duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
      this.currentTime = 0;
      this.clearSelection(false);
      this.buildTicks();
      this.render();
    }

    setCurrentTime(time) {
      this.currentTime = clamp(Number(time) || 0, 0, this.duration || 0);
      const percent = this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;
      this.elements.playhead.style.left = percent + "%";
      this.elements.progress.style.width = percent + "%";
    }

    setMode(mode) {
      this.mode = mode === "seek" ? "seek" : "annotate";
      this.renderMode();
    }

    setZoom(zoom) {
      const allowed = [1, 2, 4, 8];
      this.zoom = allowed.includes(Number(zoom)) ? Number(zoom) : 1;
      this.elements.content.style.width = (this.zoom * 100) + "%";
      this.buildTicks();
      this.renderZoom();
    }

    setStart(time, notify) {
      if (this.duration <= 0) return false;
      const value = clamp(Number(time) || 0, 0, this.duration);
      this.start = value;
      if (this.end !== null && this.end <= value) this.end = null;
      this.nextBoundary = "end";
      this.render();
      if (notify !== false) this.emitSelection();
      return true;
    }

    setEnd(time, notify) {
      if (this.duration <= 0) return false;
      const value = clamp(Number(time) || 0, 0, this.duration);
      if (this.start !== null && value <= this.start) {
        this.end = this.start;
        this.start = value;
      } else {
        this.end = value;
      }
      this.nextBoundary = "start";
      this.render();
      if (notify !== false) this.emitSelection();
      return true;
    }

    setSelection(start, end, notify) {
      this.start = Number.isFinite(start) ? clamp(start, 0, this.duration || start) : null;
      this.end = Number.isFinite(end) ? clamp(end, 0, this.duration || end) : null;
      if (this.start !== null && this.end !== null && this.end < this.start) {
        const temporary = this.start;
        this.start = this.end;
        this.end = temporary;
      }
      this.nextBoundary = this.start !== null && this.end === null ? "end" : "start";
      this.render();
      if (notify !== false) this.emitSelection();
    }

    clearSelection(notify) {
      this.start = null;
      this.end = null;
      this.nextBoundary = "start";
      this.render();
      if (notify !== false) this.emitSelection();
    }

    getSelection() {
      return { start: this.start, end: this.end };
    }

    emitSelection() {
      this.emit("onSelection", this.getSelection());
    }

    buildTicks() {
      const container = this.elements.ticks;
      container.textContent = "";
      if (this.duration <= 0) return;
      const tickCount = Math.min(80, Math.max(10, 10 * this.zoom));
      for (let index = 0; index <= tickCount; index += 1) {
        const tick = document.createElement("div");
        tick.className = "timeline-tick";
        tick.style.left = ((index / tickCount) * 100) + "%";
        if (index % Math.max(1, this.zoom) === 0 || index === tickCount) {
          const label = document.createElement("span");
          label.textContent = ((index / tickCount) * this.duration).toFixed(2);
          tick.appendChild(label);
        }
        container.appendChild(tick);
      }
    }

    render() {
      const startPercent = this.duration > 0 && this.start !== null ? (this.start / this.duration) * 100 : 0;
      const endPercent = this.duration > 0 && this.end !== null ? (this.end / this.duration) * 100 : 0;
      this.elements.startHandle.classList.toggle("hidden", this.start === null);
      this.elements.endHandle.classList.toggle("hidden", this.end === null);
      this.elements.selection.classList.toggle("hidden", this.start === null || this.end === null);
      this.elements.startHandle.style.left = startPercent + "%";
      this.elements.endHandle.style.left = endPercent + "%";
      this.elements.selection.style.left = startPercent + "%";
      this.elements.selection.style.width = Math.max(0, endPercent - startPercent) + "%";
      this.elements.endLabel.textContent = this.duration.toFixed(2);
      this.renderMode();
      this.renderZoom();
      this.setCurrentTime(this.currentTime);
    }

    renderMode() {
      const annotate = this.mode === "annotate";
      this.elements.annotateButton.classList.toggle("active", annotate);
      this.elements.seekButton.classList.toggle("active", !annotate);
      this.elements.annotateButton.setAttribute("aria-pressed", String(annotate));
      this.elements.seekButton.setAttribute("aria-pressed", String(!annotate));
      this.elements.track.style.cursor = annotate ? "crosshair" : "pointer";
      this.elements.modeStatus.textContent = annotate
        ? "下一次点击：设置 " + (this.nextBoundary === "start" ? "Start" : "End")
        : "点击时间轴：跳转播放位置（Shift+点击仍可标注）";
    }

    renderZoom() {
      this.elements.zoomButtons.forEach((button) => {
        button.classList.toggle("active", Number(button.dataset.zoom) === this.zoom);
      });
    }
  }

  namespace.TimelineController = TimelineController;
})(window.FitInteract = window.FitInteract || {});
