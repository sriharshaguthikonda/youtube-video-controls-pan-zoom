// Store original video styles
let originalVideoStyles = null;
let lastURL = null;
const DEBUG = false; // Debug flag for logging
let styleObserver = null; // Mutation observer for style changes
let lastAppliedSettings = null; // Keep track of last applied settings
let notificationTimeout = null;

// Style properties to track
const STYLE_PROPERTIES = [
  "position",
  "top",
  "left",
  "width",
  "height",
  "objectFit",
  "zIndex",
  "transformOrigin",
  "transform",
];

function log(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

function saveOriginalStyles(video) {
  if (originalVideoStyles === null) {
    originalVideoStyles = {};
    STYLE_PROPERTIES.forEach((prop) => {
      originalVideoStyles[prop] = video.style[prop];
    });
    log("Saved original video styles:", originalVideoStyles);
  }
}

function restoreOriginalStyles(video) {
  if (originalVideoStyles !== null) {
    STYLE_PROPERTIES.forEach((prop) => {
      video.style[prop] = originalVideoStyles[prop];
    });
    log("Restored original video styles");
  }
}

function isDefaultTransform(angle, zoom, fill, panX, panY) {
  return angle === 0 && zoom === 1 && panX === 0 && panY === 0 && !fill;
}

function isPanZoomActive(zoom, panX, panY) {
  return zoom !== 1 || panX !== 0 || panY !== 0;
}

function showPanZoomNotification() {
  const existing = document.getElementById("yt-pan-zoom-notification");
  if (existing) {
    existing.remove();
  }

  if (notificationTimeout) {
    clearTimeout(notificationTimeout);
  }

  const notification = document.createElement("div");
  notification.id = "yt-pan-zoom-notification";
  notification.textContent = "Pan & zoom active";
  notification.style.position = "fixed";
  notification.style.top = "16px";
  notification.style.right = "16px";
  notification.style.zIndex = "99999";
  notification.style.padding = "10px 14px";
  notification.style.background = "rgba(20, 20, 20, 0.85)";
  notification.style.color = "#fff";
  notification.style.fontSize = "13px";
  notification.style.borderRadius = "8px";
  notification.style.boxShadow = "0 6px 18px rgba(0, 0, 0, 0.3)";
  notification.style.opacity = "0";
  notification.style.transform = "translateY(-6px)";
  notification.style.transition = "opacity 0.2s ease, transform 0.2s ease";

  document.body.appendChild(notification);

  requestAnimationFrame(() => {
    notification.style.opacity = "1";
    notification.style.transform = "translateY(0)";
  });

  notificationTimeout = setTimeout(() => {
    notification.style.opacity = "0";
    notification.style.transform = "translateY(-6px)";
    notificationTimeout = setTimeout(() => {
      notification.remove();
    }, 200);
  }, 1800);
}

async function updateRememberedPanZoom(zoom, panX, panY) {
  const { rememberPanZoom } = await chrome.storage.local.get([
    "rememberPanZoom",
  ]);
  if (!rememberPanZoom) {
    return;
  }

  if (!isPanZoomActive(zoom, panX, panY)) {
    await chrome.storage.local.remove(["lastPanZoomSettings"]);
    return;
  }

  await chrome.storage.local.set({
    lastPanZoomSettings: { zoom, panX, panY },
  });
}

// Function to monitor video style changes
function setupStyleObserver(video) {
  // Remove existing observer
  if (styleObserver) {
    styleObserver.disconnect();
  }

  styleObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (
        mutation.type === "attributes" &&
        mutation.attributeName === "style"
      ) {
        // Check if we have settings to reapply
        if (lastAppliedSettings) {
          log("Video style changed, checking if we need to reapply transform");

          // Small delay to avoid rapid reapplication
          setTimeout(() => {
            // Check if our transform is still there
            const currentTransform = video.style.transform;
            const hasOurTransform =
              currentTransform.includes("rotate") ||
              currentTransform.includes("scale") ||
              currentTransform.includes("translate");

            if (
              !hasOurTransform &&
              !isDefaultTransform(
                lastAppliedSettings.angle,
                lastAppliedSettings.zoom,
                lastAppliedSettings.fill,
                lastAppliedSettings.panX,
                lastAppliedSettings.panY
              )
            ) {
              log("Transform was removed by YouTube, reapplying...");
              applyTransform(
                lastAppliedSettings.angle,
                lastAppliedSettings.zoom,
                lastAppliedSettings.fill,
                lastAppliedSettings.panX,
                lastAppliedSettings.panY
              );
            }
          }, 100);
        }
      }
    });
  });

  styleObserver.observe(video, {
    attributes: true,
    attributeFilter: ["style"],
  });
}

async function applyTransform(angle, zoom, fill, panX, panY) {
  const video = document.querySelector("video");
  if (!video) {
    log("No video element found for transform");
    return;
  }

  // Store the settings we're applying
  lastAppliedSettings = { angle, zoom, fill, panX, panY };

  // Set up style observer if not already done
  setupStyleObserver(video);

  const isFullscreen = isVideoFullscreen();
  log("Applying transform:", {
    angle,
    zoom,
    fill,
    panX,
    panY,
    isFullscreen,
    currentTransform: video.style.transform,
    currentPosition: video.style.position,
    currentTop: video.style.top,
    currentLeft: video.style.left,
    videoRect: video.getBoundingClientRect(),
    videoParent: video.parentElement,
  });

  // Check if this is a complete reset
  if (isDefaultTransform(angle, zoom, fill, panX, panY)) {
    // Complete reset - restore original styles and clear storage
    restoreOriginalStyles(video);
    originalVideoStyles = null;
    lastAppliedSettings = null;
    await chrome.storage.local.remove(["videoSettings"]);
    await updateRememberedPanZoom(zoom, panX, panY);
    log("Reset applied - cleared storage and restored original styles");

    // Disconnect observer since we're resetting
    if (styleObserver) {
      styleObserver.disconnect();
      styleObserver = null;
    }
    return;
  }

  // Always save settings to storage while on the same video (for non-reset cases)
  const settings = { angle, zoom, fill, panX, panY };
  await chrome.storage.local.set({ videoSettings: settings });
  log("Settings saved to storage:", settings);
  await updateRememberedPanZoom(zoom, panX, panY);

  // Save original styles before making any changes
  saveOriginalStyles(video);

  if (fill || isFullscreen) {
    const translateX = -50 + panX;
    const translateY = -50 + panY;

    // In fullscreen mode, we need to ensure the video takes up the full viewport
    video.style.position = "fixed";
    video.style.top = "50%";
    video.style.left = "50%";

    // Adjust dimensions based on rotation
    if (angle % 180 === 90) {
      video.style.width = "100vh";
      video.style.height = "100vw";
    } else {
      video.style.width = "100vw";
      video.style.height = "100vh";
    }

    video.style.objectFit = "cover";
    video.style.zIndex = "9999";
    video.style.transformOrigin = "center";
    video.style.transform = `translate(${translateX}%, ${translateY}%) scale(${zoom}) rotate(${angle}deg)`;

    log("Applied fullscreen/fill transform:", {
      finalTransform: video.style.transform,
      finalPosition: video.style.position,
      finalTop: video.style.top,
      finalLeft: video.style.left,
      videoRect: video.getBoundingClientRect(),
    });
  } else {
    // Non-fill mode: apply transform with panning support
    const needsTransform =
      angle !== 0 || zoom !== 1 || panX !== 0 || panY !== 0;

    if (!needsTransform) {
      video.style.transform = "";
    } else {
      let finalScale = zoom;

      // If rotated 90° or 270°, we need to scale down to fit the swapped dimensions
      if (angle % 180 === 90) {
        const rect = video.getBoundingClientRect();
        const containerWidth = rect.width;
        const containerHeight = rect.height;

        // When rotated 90°/270°, width becomes height and vice versa
        // Scale to fit within the smaller dimension
        const scaleToFit = Math.min(
          containerWidth / containerHeight,
          containerHeight / containerWidth
        );
        finalScale = zoom * scaleToFit;
      }

      video.style.transformOrigin = "center";
      // Include panning in non-fill mode
      video.style.transform = `translate(${panX}%, ${panY}%) scale(${finalScale}) rotate(${angle}deg)`;
    }

    log("Applied normal transform:", {
      finalTransform: video.style.transform,
      videoRect: video.getBoundingClientRect(),
    });
  }
}

// Simple URL-based video change detection
async function checkForNewVideo() {
  const currentURL = window.location.href;

  if (currentURL !== lastURL) {
    log("NEW VIDEO DETECTED - URL changed!");
    log("Old URL:", lastURL);
    log("New URL:", currentURL);

    lastURL = currentURL;

    // Reset original styles for new video
    originalVideoStyles = null;

    // Load persistence preference and settings from storage
    const result = await chrome.storage.local.get([
      "persistSettings",
      "videoSettings",
      "rememberPanZoom",
      "lastPanZoomSettings",
    ]);
    const persistenceEnabled = result.persistSettings || false;
    const rememberPanZoom = result.rememberPanZoom || false;

    if (!persistenceEnabled) {
      // If persistence is disabled, clear saved settings for the new video
      log("Persistence disabled, clearing saved settings for new video");
      await chrome.storage.local.remove(["videoSettings"]);
    }

    if (persistenceEnabled && result.videoSettings) {
      const settings = result.videoSettings;
      const hasSettings =
        settings.angle !== 0 ||
        settings.zoom !== 1 ||
        settings.fill ||
        settings.panX !== 0 ||
        settings.panY !== 0;

      if (hasSettings) {
        log("Reapplying saved settings to new video:", settings);
        const shouldNotify = isPanZoomActive(
          settings.zoom,
          settings.panX,
          settings.panY
        );

        // Function to attempt applying settings with better timing
        const attemptApply = (attempt = 1, maxAttempts = 20) => {
          const video = document.querySelector("video");
          if (video && video.videoWidth > 0 && video.readyState >= 2) {
            // Video is ready and has metadata, but wait a bit more for YouTube to finish
            log(
              `Video ready on attempt ${attempt}, waiting for YouTube to finish loading...`
            );
            setTimeout(() => {
              applyTransform(
                settings.angle,
                settings.zoom,
                settings.fill,
                settings.panX,
                settings.panY
              );
              if (shouldNotify) {
                showPanZoomNotification();
              }

              // Apply again after a short delay to override any YouTube changes
              setTimeout(() => {
                log("Reapplying transform to ensure it sticks");
                applyTransform(
                  settings.angle,
                  settings.zoom,
                  settings.fill,
                  settings.panX,
                  settings.panY
                );
              }, 500);
            }, 1000); // Wait 1 second after video is ready
          } else if (attempt < maxAttempts) {
            // Video not ready yet, try again
            log(
              `Video not ready on attempt ${attempt} (readyState: ${video?.readyState}, videoWidth: ${video?.videoWidth}), retrying...`
            );
            setTimeout(() => attemptApply(attempt + 1, maxAttempts), 300);
          } else {
            log("Failed to find ready video after maximum attempts");
          }
        };

        // Start attempting to apply settings with initial delay
        setTimeout(() => attemptApply(), 800);
      }
    } else if (rememberPanZoom && result.lastPanZoomSettings) {
      const panZoomSettings = result.lastPanZoomSettings;
      const hasPanZoom = isPanZoomActive(
        panZoomSettings.zoom,
        panZoomSettings.panX,
        panZoomSettings.panY
      );

      if (hasPanZoom) {
        log("Reapplying saved pan/zoom to new video:", panZoomSettings);

        const attemptApply = (attempt = 1, maxAttempts = 20) => {
          const video = document.querySelector("video");
          if (video && video.videoWidth > 0 && video.readyState >= 2) {
            log(
              `Video ready on attempt ${attempt}, waiting for YouTube to finish loading...`
            );
            setTimeout(() => {
              applyTransform(
                0,
                panZoomSettings.zoom,
                false,
                panZoomSettings.panX,
                panZoomSettings.panY
              );
              showPanZoomNotification();
            }, 1000);
          } else if (attempt < maxAttempts) {
            log(
              `Video not ready on attempt ${attempt} (readyState: ${video?.readyState}, videoWidth: ${video?.videoWidth}), retrying...`
            );
            setTimeout(() => attemptApply(attempt + 1, maxAttempts), 300);
          } else {
            log("Failed to find ready video after maximum attempts");
          }
        };

        setTimeout(() => attemptApply(), 800);
      }
    }
  }
}

// Check for URL changes every 1 second
setInterval(checkForNewVideo, 1000);

// Initial check
checkForNewVideo();

// Helper function to get the current fullscreen element
function getFullscreenElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

// Helper function to check if video is in fullscreen
function isVideoFullscreen() {
  const fullscreenElement = getFullscreenElement();
  if (!fullscreenElement) return false;

  // Check if the fullscreen element is the video or contains the video
  const video = document.querySelector("video");
  if (!video) return false;

  // Check if video is in fullscreen or if its parent is in fullscreen
  const isDirectFullscreen = fullscreenElement === video;
  const isParentFullscreen = fullscreenElement.contains(video);

  log("Fullscreen check:", {
    fullscreenElement,
    video,
    isDirectFullscreen,
    isParentFullscreen,
    videoParent: video.parentElement,
  });

  return isDirectFullscreen || isParentFullscreen;
}

// Function to handle fullscreen changes
function handleFullscreenChange() {
  log("Fullscreen change detected");

  // Get current settings from storage
  chrome.storage.local.get(["videoSettings"], (result) => {
    if (result.videoSettings) {
      const settings = result.videoSettings;
      log("Reapplying settings after fullscreen change:", settings);

      // Increase timeout to ensure video element is ready
      setTimeout(() => {
        const video = document.querySelector("video");
        if (video) {
          log("Video element found, applying transform");
          applyTransform(
            settings.angle,
            settings.zoom,
            settings.fill,
            settings.panX,
            settings.panY
          );
        } else {
          log("Video element not found after fullscreen change");
        }
      }, 300); // Increased timeout to 300ms
    } else {
      log("No settings to reapply after fullscreen change");
    }
  });
}

// Add fullscreen change listeners with vendor prefixes
document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
document.addEventListener("mozfullscreenchange", handleFullscreenChange);
document.addEventListener("MSFullscreenChange", handleFullscreenChange);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "transform") {
    applyTransform(
      request.angle,
      request.zoom,
      request.fill,
      request.panX,
      request.panY
    ).then(() => {
      sendResponse({ status: "done" });
    });
    return true; // Keep message channel open for async response
  } else if (request.action === "getSettings") {
    // Load current settings from storage
    chrome.storage.local.get(["videoSettings"]).then((result) => {
      const settings = result.videoSettings || {
        angle: 0,
        zoom: 1,
        fill: false,
        panX: 0,
        panY: 0,
      };
      const hasSettings =
        settings.angle !== 0 ||
        settings.zoom !== 1 ||
        settings.fill ||
        settings.panX !== 0 ||
        settings.panY !== 0;
      sendResponse({ settings: settings, hasSettings: hasSettings });
    });
    return true; // Keep message channel open for async response
  } else if (request.action === "setPersistence") {
    log("Persistence preference updated:", request.persistSettings);

    // If persistence is being disabled, clear saved settings (but don't reset current video)
    if (!request.persistSettings) {
      log("Persistence disabled, clearing saved settings for future videos");
      chrome.storage.local.remove(["videoSettings"]).then(() => {
        sendResponse({ status: "done" });
      });
    } else {
      sendResponse({ status: "done" });
    }
    return true; // Keep message channel open for async response
  }
});
