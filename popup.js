let currentRotation = 0;
let currentZoom = 1.0;
let currentPanX = 0;
let currentPanY = 0;

// Message handler object
const MessageHandler = {
  async sendTransform(saveToStorage = false) {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) return;

    const settings = {
      action: "transform",
      angle: currentRotation,
      zoom: currentZoom,
      fill: document.getElementById("fillScreen").checked,
      panX: currentPanX,
      panY: currentPanY,
      persistSettings: document.getElementById("persistSettings").checked,
      saveToStorage,
    };

    chrome.tabs.sendMessage(tab.id, settings);
  },

  async setPersistence(isChecked) {
    await chrome.storage.local.set({ persistSettings: isChecked });
    console.log("Saved persistence preference:", isChecked);

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, {
        action: "setPersistence",
        persistSettings: isChecked,
      });
    }
  },

  async getSettings() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) return;

    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: "getSettings" }, (response) => {
        if (response && response.hasSettings) {
          resolve(response.settings);
        } else {
          resolve(null);
        }
      });
    });
  },
};

async function loadCurrentSettings() {
  // Load persistence preference from storage
  const result = await chrome.storage.local.get(["persistSettings"]);
  const persistSettings =
    result.persistSettings !== undefined ? result.persistSettings : false;
  document.getElementById("persistSettings").checked = persistSettings;
  console.log("Loaded persistence preference:", persistSettings);

  // Send persistence preference to content script
  await MessageHandler.setPersistence(persistSettings);

  // Load current video settings
  const settings = await MessageHandler.getSettings();
  if (settings) {
    console.log("Loaded settings from content script:", settings);

    // Update internal variables
    currentRotation = settings.angle;
    currentZoom = settings.zoom;
    currentPanX = settings.panX;
    currentPanY = settings.panY;

    // Update UI to reflect current settings
    updateUI(settings);
  }
}

function updateUI(settings) {
  document.getElementById("customAngle").value = currentRotation.toString();
  document.getElementById("fillScreen").checked = settings.fill;

  document.getElementById("zoomSlider").value = currentZoom.toString();
  document.getElementById("zoomValue").textContent =
    currentZoom.toFixed(3) + "x";
  
  // Update zoom preset states
  updateZoomPresets();

  document.getElementById("panX").value = currentPanX.toString();
  document.getElementById("panXVal").textContent = currentPanX + "%";

  document.getElementById("panY").value = currentPanY.toString();
  document.getElementById("panYVal").textContent = currentPanY + "%";
}

function updateRotation(delta) {
  currentRotation = (currentRotation + delta) % 360;
  if (currentRotation < 0) currentRotation += 360;
  MessageHandler.sendTransform();
}

function resetAllControls() {
  // Reset all values to defaults
  currentRotation = 0;
  currentZoom = 1.0;
  currentPanX = 0;
  currentPanY = 0;

  // Update UI elements to reflect reset values
  updateUI({
    angle: 0,
    zoom: 1,
    fill: false,
    panX: 0,
    panY: 0,
  });

  // Apply the reset and save to storage
  MessageHandler.sendTransform(true); // Pass true to save to storage
}

// Save current settings to storage
async function saveCurrentSettings() {
  const persistSettings = document.getElementById("persistSettings").checked;
  if (persistSettings) {
    const settings = {
      angle: currentRotation,
      zoom: currentZoom,
      fill: document.getElementById("fillScreen").checked,
      panX: currentPanX,
      panY: currentPanY,
    };
    await chrome.storage.local.set({ videoSettings: settings });
    console.log("Saved current settings:", settings);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Load current settings first
  loadCurrentSettings();

  // Save settings when popup closes
  window.addEventListener("unload", () => {
    saveCurrentSettings();
  });

  // Also save when visibility changes (popup loses focus)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      saveCurrentSettings();
    }
  });

  // Save settings when window loses focus
  window.addEventListener("blur", () => {
    saveCurrentSettings();
  });

  // New rotation buttons
  document
    .getElementById("rotateCCW")
    .addEventListener("click", () => updateRotation(-90));
  document
    .getElementById("rotateCW")
    .addEventListener("click", () => updateRotation(90));

  document.getElementById("applyCustom").addEventListener("click", () => {
    let val = parseInt(document.getElementById("customAngle").value, 10);
    if (isNaN(val)) val = 0;
    currentRotation = val % 360;
    if (currentRotation < 0) currentRotation += 360;
    MessageHandler.sendTransform();
  });

  document
    .getElementById("fillScreen")
    .addEventListener("change", () => MessageHandler.sendTransform());

  // Persistence checkbox
  document
    .getElementById("persistSettings")
    .addEventListener("change", (e) =>
      MessageHandler.setPersistence(e.target.checked)
    );

  // Reset button
  document
    .getElementById("resetAll")
    .addEventListener("click", resetAllControls);

  const zoomSlider = document.getElementById("zoomSlider");
  const zoomValue = document.getElementById("zoomValue");
  
  // Update zoom value display with ultra-fine precision
  function updateZoomDisplay(value) {
    currentZoom = parseFloat(value);
    zoomValue.textContent = currentZoom.toFixed(3) + "x";
    updateZoomPresets();
    MessageHandler.sendTransform();
  }
  
  // Update zoom preset button states
  function updateZoomPresets() {
    document.querySelectorAll(".zoom-preset").forEach(btn => {
      const presetZoom = parseFloat(btn.dataset.zoom);
      if (Math.abs(currentZoom - presetZoom) < 0.01) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }
  
  zoomSlider.addEventListener("input", () => {
    updateZoomDisplay(zoomSlider.value);
  });
  
  // Add zoom preset button functionality
  document.querySelectorAll(".zoom-preset").forEach(btn => {
    btn.addEventListener("click", () => {
      const presetZoom = parseFloat(btn.dataset.zoom);
      zoomSlider.value = presetZoom;
      updateZoomDisplay(presetZoom);
    });
  });

  const panXSlider = document.getElementById("panX");
  const panYSlider = document.getElementById("panY");
  const panXVal = document.getElementById("panXVal");
  const panYVal = document.getElementById("panYVal");

  panXSlider.addEventListener("input", () => {
    currentPanX = parseInt(panXSlider.value, 10);
    panXVal.textContent = currentPanX + "%";
    MessageHandler.sendTransform();
  });

  panYSlider.addEventListener("input", () => {
    currentPanY = parseInt(panYSlider.value, 10);
    panYVal.textContent = currentPanY + "%";
    MessageHandler.sendTransform();
  });
});
