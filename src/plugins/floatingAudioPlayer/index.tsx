/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

let observer: MutationObserver;
let floatingPlayer: HTMLDivElement | null = null;
let floatingAudio: HTMLAudioElement | null = null;
let originalAudio: HTMLAudioElement | null = null;
let styleElement: HTMLStyleElement | null = null;
let channelNameLabel: HTMLSpanElement | null = null;
let wasPlaying = false;

const DEBOUNCE_DELAY = 300;
let debounceTimer: NodeJS.Timeout;

const SVGs = {
    close: '<svg width="10" height="10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>'.trim(),
    play: '<svg width="24" height="24" fill="#fff" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'.trim(),
    pause: '<svg width="24" height="24" fill="#fff" viewBox="0 0 24 24"><path d="M6 19h4V5H6zm8-14v14h4V5z"/></svg>'.trim()
};

// TODO: more styling options in settings
function injectStyles() {
    if (document.getElementById("floating-player-styles")) return;
    styleElement = document.createElement("style");
    styleElement.id = "floating-player-styles";
    styleElement.textContent = `
        #floating-audio-player {
            animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideIn {
            from { opacity: 0; transform: translateY(10px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .custom-audio-slider {
            -webkit-appearance: none;
            appearance: none;
            background: transparent;
        }
        .custom-audio-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 12px;
            height: 12px;
            background: white;
            border-radius: 50%;
            cursor: pointer;
            margin-top: -4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            transition: transform 0.1s;
        }
        .custom-audio-slider::-webkit-slider-thumb:hover {
            transform: scale(1.2);
        }
        .custom-audio-slider::-webkit-slider-runnable-track {
            width: 100%;
            height: 4px;
            cursor: pointer;
            border-radius: 2px;
        }
        .custom-audio-slider::-moz-range-thumb {
            width: 12px;
            height: 12px;
            background: white;
            border-radius: 50%;
            cursor: pointer;
            border: none;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            transition: transform 0.1s;
        }
        .custom-audio-slider::-moz-range-thumb:hover {
            transform: scale(1.2);
        }
        .custom-audio-slider::-moz-range-track {
            width: 100%;
            height: 4px;
            cursor: pointer;
            border-radius: 2px;
        }
    `;
    document.head.appendChild(styleElement);
}

function getChannelName(): string {
    let title = document.title.trim();
    title = title.replace(/^\(\d+\)\s*/, ""); // remove notification count - (1)
    title = title.replace(/^Discord\s*\|\s*/, ""); // remove Discord prefix but in app doesn't usually have it - Discord |
    return title || "audio";
}

function attachAudioListeners(audio: HTMLAudioElement) {
    if (audio.dataset.audioListener) return;
    audio.dataset.audioListener = "true";

    const source = audio.querySelector("source") as HTMLSourceElement;
    if (!source) return;
    const { src } = source;

    audio.addEventListener("play", () => {
        wasPlaying = true;
        showFloatingPlayer(src, audio, getChannelName());
    });

    audio.addEventListener("pause", () => {
        wasPlaying = false;
        if (floatingAudio && !floatingAudio.paused) {
            floatingAudio.pause();
        }
    });

    audio.addEventListener("ended", () => {
        wasPlaying = false;
    });

    audio.addEventListener("timeupdate", () => {
        if (floatingAudio && Math.abs(floatingAudio.currentTime - audio.currentTime) > 0.1) {
            floatingAudio.currentTime = audio.currentTime;
        }
    });

    audio.addEventListener("seeked", () => {
        if (floatingAudio) {
            floatingAudio.currentTime = audio.currentTime;
        }
    });
}

function showFloatingPlayer(src: string, sourceAudio: HTMLAudioElement, channelName: string = "Audio") {
    originalAudio = sourceAudio;
    injectStyles();

    if (!floatingPlayer) {
        floatingPlayer = document.createElement("div");
        floatingPlayer.id = "floating-audio-player";

        floatingPlayer.style.cssText = `
            position: fixed;
            left: 24px;
            bottom: 24px;
            width: 320px;
            height: 100px;
            background: rgba(15, 15, 20, 0.75);
            backdrop-filter: blur(16px) saturate(180%);
            -webkit-backdrop-filter: blur(16px) saturate(180%);
            padding: 12px;
            padding-top: 6px;
            border-radius: 20px;
            z-index: 10000;
            box-shadow:
                0 8px 32px rgba(0, 0, 0, 0.4),
                inset 0 1px 0 rgba(255, 255, 255, 0.1),
                0 0 0 1px rgba(0, 0, 0, 0.2);
            font-family: var(--font-primary, sans-serif);
            display: flex;
            flex-direction: column;
            gap: 8px;
            transition: transform 0.1s;
        `;

        const handleContainer = document.createElement("div");
        handleContainer.style.cssText = `
            width: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 12px;
            cursor: grab;
            margin-bottom: -4px;
        `;

        const handle = document.createElement("div");
        handle.style.cssText = `
            width: 40px;
            height: 4px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 4px;
            transition: all 0.2s;
        `;

        handleContainer.addEventListener("mouseenter", () => {
            handle.style.background = "rgba(255, 255, 255, 0.5)";
            handle.style.width = "50px";
        });
        handleContainer.addEventListener("mouseleave", () => {
            handle.style.background = "rgba(255, 255, 255, 0.2)";
            handle.style.width = "40px";
        });

        handleContainer.appendChild(handle);
        floatingPlayer.appendChild(handleContainer);

        const header = document.createElement("div");
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0 4px;
        `;

        const titleGroup = document.createElement("div");
        titleGroup.style.display = "flex";
        titleGroup.style.alignItems = "center";
        titleGroup.style.gap = "8px";

        const icon = document.createElement("div");
        icon.innerText = "💿";
        icon.style.cssText = "font-size: 16px; filter: grayscale(0.5);";

        const label = document.createElement("span");
        label.innerText = channelName;
        label.style.cssText = `
            font-size: 12px;
            font-weight: 600;
            color: rgba(255,255,255,0.7);
            letter-spacing: 0.5px;
            text-transform: uppercase;
        `;
        channelNameLabel = label;

        titleGroup.appendChild(icon);
        titleGroup.appendChild(label);
        header.appendChild(titleGroup);

        const closeBtn = document.createElement("button");
        closeBtn.innerHTML = SVGs.close;

        closeBtn.style.cssText = `
            background: rgba(255,255,255,0.1);
            border: none;
            color: rgba(255,255,255,0.6);
            cursor: pointer;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        `;

        closeBtn.addEventListener("mouseenter", () => {
            closeBtn.style.background = "#f23f43";
            closeBtn.style.color = "white";
            closeBtn.style.transform = "rotate(90deg)";
        });
        closeBtn.addEventListener("mouseleave", () => {
            closeBtn.style.background = "rgba(255,255,255,0.1)";
            closeBtn.style.color = "rgba(255,255,255,0.6)";
            closeBtn.style.transform = "rotate(0deg)";
        });

        closeBtn.addEventListener("click", () => {
            if (floatingAudio) floatingAudio.pause();
            if (floatingPlayer) floatingPlayer.remove();
            floatingPlayer = null;
            floatingAudio = null;
            originalAudio = null;
            channelNameLabel = null;
        });

        header.appendChild(closeBtn);
        floatingPlayer.appendChild(header);

        floatingAudio = document.createElement("audio");
        floatingAudio.muted = true; // avoid echo/double sound
        floatingAudio.id = "floating-audio";
        floatingAudio.style.display = "none";
        floatingPlayer.appendChild(floatingAudio);

        const controlsContainer = document.createElement("div");
        controlsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 8px;
        `;

        const progressContainer = document.createElement("div");
        progressContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        // TODO: maybe add mute button with volume icon?

        const currentTimeSpan = document.createElement("span");
        currentTimeSpan.innerText = "0:00";
        currentTimeSpan.style.cssText = "font-size: 11px; font-family: monospace; color: rgba(255,255,255,0.9); min-width: 30px;";

        const durationSpan = document.createElement("span");
        durationSpan.innerText = "0:00";
        durationSpan.style.cssText = "font-size: 11px; font-family: monospace; color: rgba(255,255,255,0.5); min-width: 30px; text-align: right;";

        const progressBar = document.createElement("input");
        progressBar.type = "range";
        progressBar.min = "0";
        progressBar.max = "100";
        progressBar.value = "0";
        progressBar.style.cssText = `
            flex: 1;
            height: 4px;
            background: rgba(255,255,255,0.1);
            border-radius: 2px;
            outline: none;
            cursor: pointer;
        `;
        progressBar.classList.add("custom-audio-slider");

        progressContainer.appendChild(currentTimeSpan);
        progressContainer.appendChild(progressBar);
        progressContainer.appendChild(durationSpan);
        controlsContainer.appendChild(progressContainer);

        const buttonsRow = document.createElement("div");
        buttonsRow.style.cssText = `
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 16px;
        `;

        const playPauseBtn = document.createElement("button");
        playPauseBtn.innerHTML = SVGs.play;

        playPauseBtn.style.cssText = `
            background: rgba(255,255,255,0.1);
            border: none;
            border-radius: 50%;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: background 0.2s;
        `;
        playPauseBtn.addEventListener("mouseenter", () => playPauseBtn.style.background = "rgba(255,255,255,0.2)");
        playPauseBtn.addEventListener("mouseleave", () => playPauseBtn.style.background = "rgba(255,255,255,0.1)");

        buttonsRow.appendChild(playPauseBtn);
        controlsContainer.appendChild(buttonsRow);

        floatingPlayer.appendChild(controlsContainer);

        const updatePlayPauseIcon = () => {
            if (floatingAudio?.paused) {
                playPauseBtn.innerHTML = SVGs.play;
            } else {
                playPauseBtn.innerHTML = SVGs.pause;
            }
        };

        playPauseBtn.addEventListener("click", () => {
            if (floatingAudio) {
                if (floatingAudio.paused) {
                    floatingAudio.muted = false;
                    floatingAudio.play();
                } else floatingAudio.pause();
            }
        });

        const formatTime = (seconds: number) => {
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            return `${m}:${s.toString().padStart(2, "0")}`;
        };

        const updateProgress = () => {
            if (!floatingAudio) return;
            const current = floatingAudio.currentTime;
            const duration = floatingAudio.duration || 1;
            progressBar.value = ((current / duration) * 100).toString();
            currentTimeSpan.innerText = formatTime(current);
            durationSpan.innerText = formatTime(duration);

            const percent = (current / duration) * 100;
            progressBar.style.background = `linear-gradient(to right, white ${percent}%, rgba(255,255,255,0.1) ${percent}%)`;
        };

        progressBar.addEventListener("input", e => {
            if (!floatingAudio) return;
            const val = parseFloat((e.target as HTMLInputElement).value);
            const time = (val / 100) * (floatingAudio.duration || 1);
            floatingAudio.currentTime = time;
        });

        floatingAudio.addEventListener("timeupdate", updateProgress);
        floatingAudio.addEventListener("loadedmetadata", updateProgress);
        floatingAudio.addEventListener("play", updatePlayPauseIcon);
        floatingAudio.addEventListener("pause", updatePlayPauseIcon);

        document.body.appendChild(floatingPlayer);

        let isDragging = false;
        let offsetX = 0, offsetY = 0;

        const onMouseDown = (e: MouseEvent) => {
            isDragging = true;
            offsetX = e.clientX - floatingPlayer!.offsetLeft;
            offsetY = e.clientY - floatingPlayer!.offsetTop;
            handleContainer.style.cursor = "grabbing";
            floatingPlayer!.style.transition = "none";
            floatingPlayer!.style.userSelect = "none";
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging || !floatingPlayer) return;
            e.preventDefault();
            const newX = e.clientX - offsetX;
            const newY = e.clientY - offsetY;

            const maxX = window.innerWidth - floatingPlayer.offsetWidth;
            const maxY = window.innerHeight - floatingPlayer.offsetHeight;

            floatingPlayer.style.left = Math.min(Math.max(0, newX), maxX) + "px";
            floatingPlayer.style.top = Math.min(Math.max(0, newY), maxY) + "px";
        };

        const onMouseUp = () => {
            isDragging = false;
            handleContainer.style.cursor = "grab";
            if (floatingPlayer) {
                floatingPlayer.style.userSelect = "auto";
                floatingPlayer.style.transition = "transform 0.1s";
            }
        };

        handleContainer.addEventListener("mousedown", onMouseDown);
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }

    if (floatingAudio && floatingAudio.src !== src) {
        floatingAudio.src = src;
        if (wasPlaying) {
            floatingAudio.play().catch(() => { });
        }
    }
}

function debounceObserverCallback() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        const voiceMessages = document.querySelectorAll("audio.audioElement_a8e786") as NodeListOf<HTMLAudioElement>;
        voiceMessages.forEach(attachAudioListeners);

        const audioFiles = document.querySelectorAll("audio.audio_cf09d8") as NodeListOf<HTMLAudioElement>;
        audioFiles.forEach(attachAudioListeners);
    }, DEBOUNCE_DELAY);
}

export default definePlugin({
    name: "Floating Audio Player",
    description: "Shows a minimalist floating audio player",
    authors: [Devs.enoughsdv],

    start() {
        injectStyles();

        const voiceMessages = document.querySelectorAll("audio.audioElement_a8e786") as NodeListOf<HTMLAudioElement>;
        voiceMessages.forEach(attachAudioListeners);

        const audioFiles = document.querySelectorAll("audio.audio_cf09d8") as NodeListOf<HTMLAudioElement>;
        audioFiles.forEach(attachAudioListeners);

        // https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
        observer = new MutationObserver(() => {
            debounceObserverCallback();
        });

        const messageContainer = document.querySelector('[role="main"]');
        if (messageContainer) {
            observer.observe(messageContainer, { childList: true, subtree: true });
        } else {
            observer.observe(document.body, { childList: true, subtree: true });
        }

        FluxDispatcher.subscribe("CHANNEL_SELECT", () => {
            if (wasPlaying && floatingAudio && floatingAudio.src) {
                const newChannelName = getChannelName();
                if (channelNameLabel) {
                    channelNameLabel.innerText = newChannelName;
                }

                setTimeout(() => {
                    if (floatingAudio) {
                        if (!floatingPlayer) {
                            showFloatingPlayer(floatingAudio.src, floatingAudio, newChannelName);
                        }
                        if (floatingAudio.paused) {
                            floatingAudio.muted = false;
                            floatingAudio.play().catch(() => { });
                        }
                    }
                }, 1 * 1000); // 1 second delay to allow channel switch to complete - TODO: find a better way
            }
        });
    },

    stop() {
        clearTimeout(debounceTimer);
        observer?.disconnect();
        if (floatingPlayer) floatingPlayer.remove();
        if (styleElement) styleElement.remove();
        floatingPlayer = null;
        floatingAudio = null;
        originalAudio = null;
        styleElement = null;
        channelNameLabel = null;
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", () => { });
    }
});
