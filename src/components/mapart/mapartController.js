import React, { Component } from "react";

import CookieManager from "../../cookieManager";
import BlockSelection from "./blockSelection";
import GreenButtons from "./greenButtons";
import MapPreview from "./mapPreview";
import MapSettings from "./mapSettings";
import Materials from "./materials";
import coloursJSON from "./json/coloursJSON.json";
import ViewOnline2D from "./viewOnline2D/viewOnline2D";
import ViewOnline3D from "./viewOnline3D/viewOnline3D";

import BackgroundColourModes from "./json/backgroundColourModes.json";
import CropModes from "./json/cropModes.json";
import DefaultPresets from "./json/defaultPresets.json";
import DitherMethods from "./json/ditherMethods.json";
import MapModes from "./json/mapModes.json";
import SupportedVersions from "./json/supportedVersions.json";
import WhereSupportBlocksModes from "./json/whereSupportBlocksModes.json";

import IMG_Upload from "../../images/upload.png";

import "./mapartController.css";

class MapartController extends Component {
  // Memoize derived values that map (staircasing mode + direction flags) to stable references. Declared as instance fields so React doesn't re-render when the cache contents change.
  _activeToneKeysCache = null;
  _applyValleyOptimizationCache = null;

  state = {
    coloursJSON: null,
    selectedBlocks: {},
    showingJSONExport: false,
    jsonExportText: "",
    showingJSONImport: false,
    jsonImportText: "",
    optionValue_version: Object.values(SupportedVersions)[Object.keys(SupportedVersions).length - 1], // default to the latest version supported
    optionValue_modeNBTOrMapdat: MapModes.SCHEMATIC_NBT.uniqueId,
    optionValue_mapSize_x: 1,
    optionValue_mapSize_y: 1,
    optionValue_cropImage: CropModes.CENTER.uniqueId,
    optionValue_cropImage_zoom: 10, // this gets scaled down by a factor of 10
    optionValue_cropImage_percent_x: 50,
    optionValue_cropImage_percent_y: 50,
    optionValue_showGridOverlay: false,
    optionValue_staircasing: MapModes.SCHEMATIC_NBT.staircaseModes.VALLEY.uniqueId,
    optionValue_staircaseYPositive: true,
    optionValue_staircaseYNegative: true,
    optionValue_staircaseYup: 0, // 0 = unlimited (no cap on how many blocks the map may rise)
    optionValue_staircaseYdown: 0, // 0 = unlimited (no cap on how many blocks the map may fall)
    optionValue_whereSupportBlocks: WhereSupportBlocksModes.ALL_OPTIMIZED.uniqueId,
    optionValue_supportBlock: "cobblestone",
    optionValue_noSupportBlocksFirstRow: false,
    optionValue_transparency: false,
    optionValue_transparencyTolerance: 128,
    optionValue_mapdatFilenameUseId: true,
    optionValue_mapdatFilenameIdStart: 0,
    optionValue_betterColour: true,
    optionValue_dithering: DitherMethods.FloydSteinberg.uniqueId,
    optionValue_preprocessingEnabled: false,
    preProcessingValue_brightness: 100,
    preProcessingValue_contrast: 100,
    preProcessingValue_saturation: 100,
    preProcessingValue_backgroundColourSelect: BackgroundColourModes.OFF.uniqueId,
    preProcessingValue_backgroundColour: "#151515",
    optionValue_extras_moreStaircasingOptions: false,
    optionValue_minimumBlockCountEnabled: false,
    optionValue_minimumBlockCount: 50,
    mapPreviewRegenerateCounter: 0,
    uploadedImage: null,
    uploadedImage_baseFilename: null,
    presets: [],
    selectedPresetName: "None",
    currentMaterialsData: {
      pixelsData: null,
      maps: [[]], // entries are dictionaries with keys "materials", "supportBlockCount"
      currentSelectedBlocks: {}, // we keep this soley for materials.js
    },
    mapPreviewWorker_inProgress: false,
    viewOnline_NBT: null,
    viewOnline_3D: false,
  };

  constructor(props) {
    super(props);
    // update default presets to latest version; done via checking for localeString
    CookieManager.init();
    let cookiesPresets_loaded = JSON.parse(CookieManager.touchCookie("mapartcraft_presets", JSON.stringify(DefaultPresets)));
    let cookiesPresets_updated = [];
    for (const cookiesPreset_loaded of cookiesPresets_loaded) {
      let cookiesPreset_updated = undefined;
      if ("localeKey" in cookiesPreset_loaded) {
        cookiesPreset_updated = DefaultPresets.find((defaultPreset) => defaultPreset.localeKey === cookiesPreset_loaded.localeKey);
      }
      if (cookiesPreset_updated === undefined) {
        cookiesPreset_updated = cookiesPreset_loaded;
      }
      cookiesPresets_updated.push(cookiesPreset_updated);
    }
    CookieManager.setCookie("mapartcraft_presets", JSON.stringify(cookiesPresets_updated));
    this.state.presets = cookiesPresets_updated;

    let cookie_customBlocks = JSON.parse(CookieManager.touchCookie("mapartcraft_customBlocks", JSON.stringify([])));
    this.state.coloursJSON = this.getMergedColoursJSON(cookie_customBlocks);

    for (const colourSetId of Object.keys(this.state.coloursJSON)) {
      this.state.selectedBlocks[colourSetId] = "-1";
    }

    const cookieMCVersion = CookieManager.touchCookie("mapartcraft_mcversion", Object.values(SupportedVersions)[Object.keys(SupportedVersions).length - 1].MCVersion);
    const supportedVersionFound = Object.values(SupportedVersions).find((supportedVersion) => supportedVersion.MCVersion === cookieMCVersion);
    if (supportedVersionFound !== undefined) {
      this.state.optionValue_version = supportedVersionFound;
    }

    const URLParams = new URL(window.location).searchParams;
    if (URLParams.has("preset")) {
      const decodedPresetBlocks = this.URLToPreset(URLParams.get("preset"));
      if (decodedPresetBlocks !== null) {
        this.state.selectedBlocks = decodedPresetBlocks;
      }
    }
  }

  getMergedColoursJSON(customBlocks) {
    // this is how we currently merge custom blocks into coloursJSON at runtime / when custom blocks update. this may change if presets support for custom blocks is added
    let coloursJSON_custom = JSON.parse(JSON.stringify(coloursJSON)); // hmmm
    for (const [colourSetId, customBlock] of customBlocks) {
      coloursJSON_custom[colourSetId].blocks[Object.keys(coloursJSON_custom[colourSetId].blocks).length.toString()] = customBlock;
    }
    return coloursJSON_custom;
  }

  eventListener_dragover = function (e) {
    // this has to be here for drop event to work
    e.preventDefault();
    e.stopPropagation();
  };

  eventListener_drop = function (e) {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files.length) {
      const file = files[0];
      const imgUrl = URL.createObjectURL(file);
      this.loadUploadedImageFromURL(imgUrl, "mapart");
    }
  }.bind(this);

  eventListener_paste = function (e) {
    e.preventDefault();
    e.stopPropagation();
    const files = e.clipboardData.files;
    if (files.length) {
      const file = files[0];
      const imgUrl = URL.createObjectURL(file);
      this.loadUploadedImageFromURL(imgUrl, "mapart");
    }
  }.bind(this);

  componentDidMount() {
    this.loadUploadedImageFromURL(IMG_Upload, "mapart");

    document.addEventListener("dragover", this.eventListener_dragover);
    document.addEventListener("drop", this.eventListener_drop);

    document.addEventListener("paste", this.eventListener_paste);
  }

  componentWillUnmount() {
    document.removeEventListener("dragover", this.eventListener_dragover);
    document.removeEventListener("drop", this.eventListener_drop);
    document.removeEventListener("paste", this.eventListener_paste);
  }

  onFileDialogEvent = (e) => {
    const files = e.target.files;
    if (!files.length) {
      return;
    } else {
      const file = files[0];
      const imgUrl = URL.createObjectURL(file);
      this.loadUploadedImageFromURL(imgUrl, file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  loadUploadedImageFromURL(imageURL, baseFilename) {
    const img = new Image();
    img.onload = () => {
      this.setState({
        uploadedImage: img,
        uploadedImage_baseFilename: baseFilename,
      });
    };
    img.src = imageURL;
  }

  handleChangeColourSetBlock = (colourSetId, blockId) => {
    let selectedBlocks = { ...this.state.selectedBlocks };
    selectedBlocks[colourSetId] = blockId;
    this.setState({
      selectedBlocks,
    });
  };

  handleChangeColourSetBlocks = (setsAndBlocks) => {
    const { coloursJSON, optionValue_version } = this.state;
    let selectedBlocks = {};
    for (const colourSetId of Object.keys(coloursJSON)) {
      selectedBlocks[colourSetId] = "-1";
    }
    for (const [int_colourSetId, presetIndex] of setsAndBlocks) {
      // we store presetIndex in the cookie, not blockId
      const colourSetId = int_colourSetId.toString();
      if (!(colourSetId in coloursJSON)) {
        continue;
      }
      const blockIdAndBlock = Object.entries(coloursJSON[colourSetId].blocks).find(([, block]) => block.presetIndex === presetIndex);
      if (blockIdAndBlock === undefined) {
        continue;
      }
      const blockId = blockIdAndBlock[0];
      if (Object.keys(coloursJSON[colourSetId].blocks[blockId].validVersions).includes(optionValue_version.MCVersion)) {
        selectedBlocks[colourSetId] = blockId;
      }
    }
    this.setState({
      selectedBlocks,
    });
  };

  onOptionChange_modeNBTOrMapdat = (e) => {
    const mode = parseInt(e.target.value);
    this.setState({ optionValue_modeNBTOrMapdat: mode });
    if (mode === MapModes.SCHEMATIC_NBT.uniqueId) {
      this.setState({ optionValue_staircasing: MapModes.SCHEMATIC_NBT.staircaseModes.VALLEY.uniqueId });
    } else {
      this.setState({ optionValue_staircasing: MapModes.MAPDAT.staircaseModes.ON_UNOBTAINABLE.uniqueId });
    }
  };

  onOptionChange_version = (e) => {
    const { coloursJSON } = this.state;
    const mcVersion = e.target.value;
    CookieManager.setCookie("mapartcraft_mcversion", mcVersion);
    const supportedVersionFound = Object.values(SupportedVersions).find((supportedVersion) => supportedVersion.MCVersion === mcVersion);
    this.setState((currentState) => {
      let selectedBlocks = { ...currentState.selectedBlocks };
      for (const [colourSetId, colourSet] of Object.entries(coloursJSON)) {
        if (selectedBlocks[colourSetId] !== "-1" && !Object.keys(colourSet.blocks[selectedBlocks[colourSetId]].validVersions).includes(mcVersion)) {
          selectedBlocks[colourSetId] = "-1";
        }
      }
      return { optionValue_version: supportedVersionFound, selectedBlocks };
    });
  };

  onOptionChange_mapSize_x = (value) => {
    this.setState({
      optionValue_mapSize_x: value,
    });
  };

  onOptionChange_mapSize_y = (value) => {
    this.setState({
      optionValue_mapSize_y: value,
    });
  };

  onOptionChange_cropImage = (e) => {
    const cropValue = parseInt(e.target.value);
    // CENTER is a special case of MANUAL
    // reset cropImage variables any time we change
    this.setState({
      optionValue_cropImage: cropValue,
      optionValue_cropImage_zoom: 10,
      optionValue_cropImage_percent_x: 50,
      optionValue_cropImage_percent_y: 50,
    });
  };

  onOptionChange_cropImage_zoom = (value) => {
    this.setState({
      optionValue_cropImage_zoom: value,
    });
  };

  onOptionChange_cropImage_percent_x = (value) => {
    this.setState({
      optionValue_cropImage_percent_x: value,
    });
  };

  onOptionChange_cropImage_percent_y = (value) => {
    this.setState({
      optionValue_cropImage_percent_y: value,
    });
  };

  onOptionChange_showGridOverlay = () => {
    this.setState({
      optionValue_showGridOverlay: !this.state.optionValue_showGridOverlay,
    });
    // "updatePreviewScale(0)"
  };

  onOptionChange_staircasing = (e) => {
    const staircasingValue = parseInt(e.target.value);
    this.setState({ optionValue_staircasing: staircasingValue });
  };

  onOptionChange_staircaseYPositive = () => {
    this.setState((currentState) => ({
      optionValue_staircaseYPositive: !currentState.optionValue_staircaseYPositive,
    }));
  };

  onOptionChange_staircaseYNegative = () => {
    this.setState((currentState) => ({
      optionValue_staircaseYNegative: !currentState.optionValue_staircaseYNegative,
    }));
  };

  onOptionChange_staircaseYup = (e) => {
    const value = Math.max(0, parseInt(e.target.value, 10) || 0);
    this.setState({ optionValue_staircaseYup: value });
  };

  onOptionChange_staircaseYdown = (e) => {
    const value = Math.max(0, parseInt(e.target.value, 10) || 0);
    this.setState({ optionValue_staircaseYdown: value });
  };

  isCustom3DMode() {
    const { optionValue_modeNBTOrMapdat, optionValue_staircasing } = this.state;
    return (
      optionValue_staircasing === MapModes.SCHEMATIC_NBT.staircaseModes.CUSTOM_3D.uniqueId ||
      optionValue_staircasing === MapModes.MAPDAT.staircaseModes.CUSTOM_3D.uniqueId
    );
  }

  getToneKeysMemoKey() {
    // Note: optionValue_staircaseYup/Ydown are intentionally NOT part of this key. They don't change
    // which tone keys are structurally available (that's still driven by mode/staircasing/Positive/Negative);
    // they only cap how far the worker lets a column climb/descend. They reach the worker via their own
    // props on <MapPreview> (see mapPreview.js), independently of this memoized array.
    const { optionValue_modeNBTOrMapdat, optionValue_staircasing, optionValue_staircaseYPositive, optionValue_staircaseYNegative } = this.state;
    return `${optionValue_modeNBTOrMapdat}|${optionValue_staircasing}|${optionValue_staircaseYPositive}|${optionValue_staircaseYNegative}`;
  }

  getActiveToneKeys() {
    // Memoized: returns the same array reference when inputs are unchanged so child componentDidUpdate propChecks see a stable identity (otherwise the canvas componentDidUpdate triggers an infinite update loop).
    const key = this.getToneKeysMemoKey();
    const cached = this._activeToneKeysCache;
    if (cached !== null && cached.key === key) {
      return cached.value;
    }
    const { optionValue_modeNBTOrMapdat, optionValue_staircasing, optionValue_staircaseYPositive, optionValue_staircaseYNegative } = this.state;
    let value;
    if (this.isCustom3DMode()) {
      const keys = ["normal"];
      if (optionValue_staircaseYNegative) keys.unshift("dark");
      if (optionValue_staircaseYPositive) keys.push("light");
      value = keys;
    } else {
      value = Object.values(Object.values(MapModes).find((mapMode) => mapMode.uniqueId === optionValue_modeNBTOrMapdat).staircaseModes).find(
        (staircaseMode) => staircaseMode.uniqueId === optionValue_staircasing
      ).toneKeys;
    }
    this._activeToneKeysCache = { key, value };
    return value;
  }

  isStaircasingEnabled() {
    const { optionValue_staircasing } = this.state;
    if (this.isCustom3DMode()) {
      return this.state.optionValue_staircaseYPositive || this.state.optionValue_staircaseYNegative;
    }
    return [
      MapModes.SCHEMATIC_NBT.staircaseModes.CLASSIC.uniqueId,
      MapModes.SCHEMATIC_NBT.staircaseModes.VALLEY.uniqueId,
      MapModes.MAPDAT.staircaseModes.ON.uniqueId,
      MapModes.MAPDAT.staircaseModes.ON_UNOBTAINABLE.uniqueId,
    ].includes(optionValue_staircasing);
  }

  applyValleyOptimization() {
    // Memoized for symmetry with getActiveToneKeys; avoids spurious re-renders if any caller compares references.
    const key = this.getToneKeysMemoKey();
    const cached = this._applyValleyOptimizationCache;
    if (cached !== null && cached.key === key) {
      return cached.value;
    }
    const { optionValue_modeNBTOrMapdat, optionValue_staircasing, optionValue_staircaseYPositive, optionValue_staircaseYNegative } = this.state;
    let value = false;
    if (optionValue_modeNBTOrMapdat === MapModes.SCHEMATIC_NBT.uniqueId) {
      if (optionValue_staircasing === MapModes.SCHEMATIC_NBT.staircaseModes.VALLEY.uniqueId) {
        value = true;
      } else if (
        optionValue_staircasing === MapModes.SCHEMATIC_NBT.staircaseModes.CUSTOM_3D.uniqueId &&
        optionValue_staircaseYPositive &&
        optionValue_staircaseYNegative
      ) {
        value = true;
      }
    }
    this._applyValleyOptimizationCache = { key, value };
    return value;
  }

  onOptionChange_transparency = () => {
    this.setState({
      optionValue_transparency: !this.state.optionValue_transparency,
    });
  };

  onOptionChange_transparencyTolerance = (value) => {
    this.setState({
      optionValue_transparencyTolerance: value,
    });
  };

  onOptionChange_mapdatFilenameUseId = () => {
    this.setState((currentState) => {
      return {
        optionValue_mapdatFilenameUseId: !currentState.optionValue_mapdatFilenameUseId,
      };
    });
  };

  onOptionChange_mapdatFilenameIdStart = (value) => {
    this.setState({
      optionValue_mapdatFilenameIdStart: value,
    });
  };

  onOptionChange_BetterColour = () => {
    this.setState({
      optionValue_betterColour: !this.state.optionValue_betterColour,
    });
  };

  onOptionChange_dithering = (e) => {
    const ditheringValue = parseInt(e.target.value);
    this.setState({ optionValue_dithering: ditheringValue });
  };

  onOptionChange_WhereSupportBlocks = (e) => {
    const newValue = parseInt(e.target.value);
    this.setState({ optionValue_whereSupportBlocks: newValue });
  };

  setOption_SupportBlock = (text) => {
    this.setState({ optionValue_supportBlock: text });
  };

  onOptionChange_noSupportBlocksFirstRow = () => {
    this.setState({ optionValue_noSupportBlocksFirstRow: !this.state.optionValue_noSupportBlocksFirstRow });
  };

  onOptionChange_PreProcessingEnabled = () => {
    this.setState({
      optionValue_preprocessingEnabled: !this.state.optionValue_preprocessingEnabled,
    });
  };

  onOptionChange_PreProcessingBrightness = (value) => {
    this.setState({
      preProcessingValue_brightness: value,
    });
  };

  onOptionChange_PreProcessingContrast = (value) => {
    this.setState({
      preProcessingValue_contrast: value,
    });
  };

  onOptionChange_PreProcessingSaturation = (value) => {
    this.setState({
      preProcessingValue_saturation: value,
    });
  };

  onOptionChange_PreProcessingBackgroundColourSelect = (e) => {
    const newValue = parseInt(e.target.value);
    this.setState({ preProcessingValue_backgroundColourSelect: newValue });
  };

  onOptionChange_PreProcessingBackgroundColour = (e) => {
    const newValue = e.target.value;
    this.setState({ preProcessingValue_backgroundColour: newValue });
  };

  onOptionChange_extras_moreStaircasingOptions = () => {
    const { optionValue_modeNBTOrMapdat, optionValue_extras_moreStaircasingOptions } = this.state;
    this.setState({ optionValue_extras_moreStaircasingOptions: !optionValue_extras_moreStaircasingOptions });
    if (optionValue_extras_moreStaircasingOptions) {
      if (optionValue_modeNBTOrMapdat === MapModes.SCHEMATIC_NBT.uniqueId) {
        this.setState({ optionValue_staircasing: MapModes.SCHEMATIC_NBT.staircaseModes.VALLEY.uniqueId });
      } else {
        this.setState({ optionValue_staircasing: MapModes.MAPDAT.staircaseModes.ON_UNOBTAINABLE.uniqueId });
      }
    }
  };

  onOptionChange_minimumBlockCountEnabled = () => {
    this.setState((currentState) => ({
      optionValue_minimumBlockCountEnabled: !currentState.optionValue_minimumBlockCountEnabled,
      mapPreviewRegenerateCounter: currentState.mapPreviewRegenerateCounter + 1,
    }));
  };

  onOptionChange_minimumBlockCount = (value) => {
    this.setState((currentState) => ({
      optionValue_minimumBlockCount: value,
      mapPreviewRegenerateCounter: currentState.mapPreviewRegenerateCounter + 1,
    }));
  };

  onGetViewOnlineNBT = (viewOnline_NBT) => {
    this.setState({ viewOnline_NBT });
  };

  downloadBlobFile(downloadBlob, filename) {
    const downloadURL = window.URL.createObjectURL(downloadBlob);
    const downloadElt = document.createElement("a");
    downloadElt.style = "display: none";
    downloadElt.href = downloadURL;
    downloadElt.download = filename;
    document.body.appendChild(downloadElt);
    downloadElt.click();
    window.URL.revokeObjectURL(downloadURL);
    document.body.removeChild(downloadElt);
  }

  handleGetPDNPaletteClicked = () => {
    const { getLocaleString } = this.props;
    const { coloursJSON, selectedBlocks, optionValue_modeNBTOrMapdat, optionValue_staircasing } = this.state;
    let paletteText =
      "; paint.net Palette File\n; Generated by MapartCraft\n; Link to preset: " +
      this.selectedBlocksToURL() +
      (Object.entries(selectedBlocks).some(([colourSetId, blockId]) => blockId !== "-1" && coloursJSON[colourSetId].blocks[blockId].presetIndex === "CUSTOM")
        ? "\n; Custom blocks not listed!"
        : "") +
      "\n; staircasing: " + (this.isStaircasingEnabled() ? "enabled" : "disabled") +
      "\n; unobtainable colours: " +
      ([MapModes.MAPDAT.staircaseModes.ON_UNOBTAINABLE.uniqueId, MapModes.MAPDAT.staircaseModes.FULL_UNOBTAINABLE.uniqueId].includes(optionValue_staircasing)
        ? "enabled"
        : "disabled") +
      "\n";
    let numberOfColoursExported = 0;
    const toneKeysToExport = this.getActiveToneKeys();
    // TODO change from uniqueId to key
    for (const [selectedBlock_colourSetId, selectedBlock_blockId] of Object.entries(selectedBlocks)) {
      if (selectedBlock_blockId !== "-1") {
        let colours = coloursJSON[selectedBlock_colourSetId].tonesRGB;
        for (const toneKeyToExport of toneKeysToExport) {
          numberOfColoursExported += 1;
          paletteText += "FF";
          for (let i = 0; i < 3; i++) {
            paletteText += Number(colours[toneKeyToExport][i]).toString(16).padStart(2, "0").toUpperCase();
          }
          paletteText += "\n";
        }
      }
    }
    if (numberOfColoursExported === 0) {
      alert(getLocaleString("BLOCK-SELECTION/PRESETS/DOWNLOAD-WARNING-NONE-SELECTED"));
      return;
    } else if (numberOfColoursExported > 96) {
      alert(
        `${getLocaleString("BLOCK-SELECTION/PRESETS/DOWNLOAD-WARNING-MAX-COLOURS-1")}${numberOfColoursExported.toString()}${getLocaleString(
          "BLOCK-SELECTION/PRESETS/DOWNLOAD-WARNING-MAX-COLOURS-2"
        )}`
      );
    }
    const downloadBlob = new Blob([paletteText], { type: "text/plain" });
    this.downloadBlobFile(downloadBlob, "MapartcraftPalette.txt");
  };

  handlePresetChange = (e) => {
    const presetName = e.target.value;
    const { presets } = this.state;

    this.setState({ selectedPresetName: presetName });

    if (presetName === "None") {
      this.handleChangeColourSetBlocks([]);
    } else {
      const selectedPreset = presets.find((preset) => preset.name === presetName);
      if (selectedPreset !== undefined) {
        this.handleChangeColourSetBlocks(selectedPreset.blocks);
      }
    }
  };

  canDeletePreset = () => {
    const { selectedPresetName } = this.state;
    return selectedPresetName !== "None" && !DefaultPresets.find((defaultPreset) => defaultPreset.name === selectedPresetName);
  };

  handleDeletePreset = () => {
    const { getLocaleString } = this.props;
    const { presets, selectedPresetName } = this.state;
    if (!this.canDeletePreset()) return;
    if (!window.confirm(`${getLocaleString("BLOCK-SELECTION/PRESETS/DELETE-CONFIRM")} ${selectedPresetName}`)) return;
    const presets_new = presets.filter((preset) => preset.name !== selectedPresetName);
    this.setState({
      presets: presets_new,
      selectedPresetName: "None",
    });
    CookieManager.setCookie("mapartcraft_presets", JSON.stringify(presets_new));
  };

  handleSavePreset = () => {
    const { getLocaleString } = this.props;
    const { coloursJSON, presets, selectedBlocks } = this.state;

    let presetToSave_name = prompt(getLocaleString("BLOCK-SELECTION/PRESETS/SAVE-PROMPT-ENTER-NAME"), "");
    if (presetToSave_name === null) {
      return;
    }

    const otherPresets = presets.filter((preset) => preset.name !== presetToSave_name);
    let newPreset = { name: presetToSave_name, blocks: [] };
    Object.keys(selectedBlocks).forEach((key) => {
      if (selectedBlocks[key] !== "-1" && coloursJSON[key].blocks[selectedBlocks[key]].presetIndex !== "CUSTOM") {
        newPreset.blocks.push([parseInt(key), parseInt(coloursJSON[key].blocks[selectedBlocks[key]].presetIndex)]);
      }
    });
    const presets_new = [...otherPresets, newPreset];
    this.setState({
      presets: presets_new,
      selectedPresetName: presetToSave_name,
    });
    CookieManager.setCookie("mapartcraft_presets", JSON.stringify(presets_new));
  };

  selectedBlocksToURL = () => {
    // colourSetId encoded in base 36 as [0-9a-z]
    // blockId encoded in modified base 26 as [Q-ZA-P]
    const { coloursJSON, selectedBlocks } = this.state;
    let presetQueryString = "";
    for (const [colourSetId, blockId] of Object.entries(selectedBlocks)) {
      if (blockId !== "-1" && coloursJSON[colourSetId].blocks[blockId].presetIndex !== "CUSTOM") {
        presetQueryString += parseInt(colourSetId).toString(36);
        presetQueryString += coloursJSON[colourSetId].blocks[blockId].presetIndex
          .toString(26)
          .toUpperCase()
          .replace(/[0-9]/g, (match) => {
            return {
              0: "Q",
              1: "R",
              2: "S",
              3: "T",
              4: "U",
              5: "V",
              6: "W",
              7: "X",
              8: "Y",
              9: "Z",
            }[match];
          });
      }
    }
    return window.location.origin + window.location.pathname + "?preset=" + presetQueryString;
  };

  handleSharePreset = () => {
    const { getLocaleString } = this.props;
    const { coloursJSON, selectedBlocks } = this.state;
    if (Object.keys(selectedBlocks).every((colourSetId) => selectedBlocks[colourSetId] === "-1")) {
      alert(getLocaleString("BLOCK-SELECTION/PRESETS/SHARE-WARNING-NONE-SELECTED"));
    } else {
      if (
        Object.entries(selectedBlocks).some(([colourSetId, blockId]) => blockId !== "-1" && coloursJSON[colourSetId].blocks[blockId].presetIndex === "CUSTOM")
      ) {
        alert(getLocaleString("BLOCK-SELECTION/ADD-CUSTOM/NO-EXPORT"));
      }
      prompt(getLocaleString("BLOCK-SELECTION/PRESETS/SHARE-LINK"), this.selectedBlocksToURL());
    }
  };

  handleExportJSON = () => {
    const { getLocaleString } = this.props;
    const { coloursJSON, selectedBlocks } = this.state;
    const blocks = [];
    for (const [colourSetId, blockId] of Object.entries(selectedBlocks)) {
      if (blockId === "-1") {
        continue;
      }
      const block = coloursJSON[colourSetId].blocks[blockId];
      if (block.presetIndex === "CUSTOM") {
        blocks.push({
          colourSetId,
          blockId: "CUSTOM",
          customBlock: {
            displayName: block.displayName,
            validVersions: block.validVersions,
            supportBlockMandatory: block.supportBlockMandatory,
            flammable: block.flammable,
          },
        });
      } else {
        blocks.push({ colourSetId, blockId });
      }
    }
    if (blocks.length === 0) {
      alert(getLocaleString("BLOCK-SELECTION/PRESETS/EXPORT-JSON-NONE-SELECTED"));
      return;
    }
    const json = JSON.stringify({ format: "mapartcraft-json-preset", version: 1, blocks }, null, 2);
    this.setState({ jsonExportText: json, showingJSONExport: true });
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).catch(() => {});
    }
  };

  handleExportJSONClose = () => {
    this.setState({ showingJSONExport: false, jsonExportText: "" });
  };

  handleExportJSONCopy = () => {
    const { getLocaleString } = this.props;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(this.state.jsonExportText).catch(() => {
        alert(getLocaleString("BLOCK-SELECTION/PRESETS/IMPORT-JSON-ERROR"));
      });
    }
  };

  handleImportJSONPaste = () => {
    const { getLocaleString } = this.props;
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard
        .readText()
        .then((text) => this.setState({ jsonImportText: text }))
        .catch(() => {
          alert(getLocaleString("BLOCK-SELECTION/PRESETS/IMPORT-JSON-ERROR"));
        });
    }
  };

  handleImportJSONOpen = () => {
    this.setState({ showingJSONImport: true, jsonImportText: "" });
  };

  handleImportJSONTextChange = (e) => {
    this.setState({ jsonImportText: e.target.value });
  };

  handleImportJSONCancel = () => {
    this.setState({ showingJSONImport: false, jsonImportText: "" });
  };

  handleImportJSONApply = () => {
    const { getLocaleString } = this.props;
    const { jsonImportText, optionValue_version } = this.state;
    let data;
    try {
      data = JSON.parse(jsonImportText);
    } catch (e) {
      alert(getLocaleString("BLOCK-SELECTION/PRESETS/IMPORT-JSON-ERROR"));
      return;
    }
    if (!data || !Array.isArray(data.blocks)) {
      alert(getLocaleString("BLOCK-SELECTION/PRESETS/IMPORT-JSON-ERROR"));
      return;
    }
    const mcVersion = optionValue_version.MCVersion;
    let customBlocks = JSON.parse(CookieManager.getCookie("mapartcraft_customBlocks"));
    const addedCustomKeys = new Set(
      customBlocks.map((customBlock) => customBlock[0] + "|" + customBlock[1].displayName + "|" + JSON.stringify(customBlock[1].validVersions))
    );
    for (const entry of data.blocks) {
      if (entry.customBlock) {
        const key = entry.colourSetId + "|" + entry.customBlock.displayName + "|" + JSON.stringify(entry.customBlock.validVersions);
        if (!addedCustomKeys.has(key)) {
          customBlocks.push([entry.colourSetId, entry.customBlock]);
          addedCustomKeys.add(key);
        }
      }
    }
    const coloursJSON_new = this.getMergedColoursJSON(customBlocks);
    CookieManager.setCookie("mapartcraft_customBlocks", JSON.stringify(customBlocks));
    const selectedBlocks_new = { ...this.state.selectedBlocks };
    for (const entry of data.blocks) {
      const { colourSetId } = entry;
      if (!(colourSetId in coloursJSON_new)) {
        continue;
      }
      if (entry.customBlock) {
        let blockId = "-1";
        for (const [bid, block] of Object.entries(coloursJSON_new[colourSetId].blocks)) {
          if (block.presetIndex === "CUSTOM" && block.displayName === entry.customBlock.displayName && mcVersion in block.validVersions) {
            blockId = bid;
            break;
          }
        }
        selectedBlocks_new[colourSetId] = blockId;
      } else if (entry.blockId in coloursJSON_new[colourSetId].blocks) {
        const block = coloursJSON_new[colourSetId].blocks[entry.blockId];
        if (mcVersion in block.validVersions) {
          selectedBlocks_new[colourSetId] = entry.blockId;
        }
      }
    }
    this.setState({
      coloursJSON: coloursJSON_new,
      selectedBlocks: selectedBlocks_new,
      currentMaterialsData: {
        pixelsData: null,
        maps: [[]],
        currentSelectedBlocks: {},
      },
      showingJSONImport: false,
      jsonImportText: "",
    });
  };

  URLToPreset = (encodedPreset) => {
    const { onCorruptedPreset } = this.props;
    const { coloursJSON, optionValue_version } = this.state;
    switch (encodedPreset) {
      case "dQw4w9WgXcQ":
        window.location.replace("https://www.youtube.com/watch?v=cZ5wOPinZd4");
        return null;
      case "mares":
        document.body.style.backgroundSize="100%";
        fetch("https://derpibooru.org/api/v1/json/search/images?q=scenery,score.gte:1000,safe&sf=random&per_page=1").then(req=>req.json()).then(derp=>document.body.style.backgroundImage=`url(${derp.images[0].representations.full})`);
        return null;
    }
    if (!/^[0-9a-zQ-ZA-P]*$/g.test(encodedPreset)) {
      onCorruptedPreset();
      return null;
    }
    let selectedBlocks = { ...this.state.selectedBlocks };
    let presetRegex = /([0-9a-z]+)(?=([Q-ZA-P]+))/g;
    let match;
    while ((match = presetRegex.exec(encodedPreset)) !== null) {
      const encodedColourSetId = match[1];
      const encodedBlockId = match[2];
      const decodedColourSetId = parseInt(encodedColourSetId, 36).toString();
      const decodedPresetIndex = parseInt(
        encodedBlockId
          .replace(/[Q-Z]/g, (match) => {
            return {
              Q: "0",
              R: "1",
              S: "2",
              T: "3",
              U: "4",
              V: "5",
              W: "6",
              X: "7",
              Y: "8",
              Z: "9",
            }[match];
          })
          .toLowerCase(),
        26
      );
      if (!(decodedColourSetId in coloursJSON)) {
        continue;
      }
      const decodedBlock = Object.entries(coloursJSON[decodedColourSetId].blocks).find((elt) => elt[1].presetIndex === decodedPresetIndex);
      if (decodedBlock === undefined) {
        continue;
      }
      const decodedBlockId = decodedBlock[0].toString();
      if (Object.keys(coloursJSON[decodedColourSetId].blocks[decodedBlockId].validVersions).includes(optionValue_version.MCVersion)) {
        selectedBlocks[decodedColourSetId] = decodedBlockId;
      }
    }
    return selectedBlocks;
  };

  onMapPreviewWorker_begin = () => {
    this.setState({ mapPreviewWorker_inProgress: true });
  };

  handleSetMapMaterials = (currentMaterialsData) => {
    let selectedBlocks = this.state.selectedBlocks;
    let didAutoBlacklist = false;
    if (this.state.optionValue_minimumBlockCountEnabled && this.state.optionValue_minimumBlockCount > 0) {
      const totals = {};
      for (const row of currentMaterialsData.maps) {
        for (const map of row) {
          for (const [colourSetId, materialCount] of Object.entries(map.materials)) {
            totals[colourSetId] = (totals[colourSetId] || 0) + materialCount;
          }
        }
      }
      for (const [colourSetId, count] of Object.entries(totals)) {
        if (count < this.state.optionValue_minimumBlockCount && selectedBlocks[colourSetId] !== "-1") {
          selectedBlocks = { ...selectedBlocks, [colourSetId]: "-1" };
          didAutoBlacklist = true;
        }
      }
    }
    const nextRegenerateCounter = didAutoBlacklist ? this.state.mapPreviewRegenerateCounter + 1 : this.state.mapPreviewRegenerateCounter;
    this.setState({
      selectedBlocks,
      currentMaterialsData: currentMaterialsData,
      mapPreviewWorker_inProgress: false,
      mapPreviewRegenerateCounter: nextRegenerateCounter,
    });
  };

  onChooseViewOnline3D = () => {
    this.setState({ viewOnline_3D: true });
  };

  handleViewOnline3DEscape = () => {
    this.setState({
      viewOnline_NBT: null,
      viewOnline_3D: false,
    });
  };

  handleAddCustomBlock = (block_colourSetId, block_name, block_nbtTags, block_versions, block_needsSupport, block_flammable) => {
    const { getLocaleString } = this.props;
    // const {coloursJSON} = this.state;
    const block_name_trimmed = block_name.trim();
    if (block_name_trimmed === "") {
      alert(getLocaleString("BLOCK-SELECTION/ADD-CUSTOM/ERROR-NO-NAME"));
      return;
    }
    if (Object.values(block_versions).every((t) => !t)) {
      alert(getLocaleString("BLOCK-SELECTION/ADD-CUSTOM/ERROR-NONE-SELECTED"));
      return;
    }
    let blockToAdd = {
      displayName: block_name_trimmed,
      validVersions: {},
      supportBlockMandatory: block_needsSupport,
      flammable: block_flammable,
      presetIndex: "CUSTOM",
    };
    let addedFirstVersion = false;
    for (const [block_version, block_version_isSelected] of Object.entries(block_versions)) {
      if (!block_version_isSelected) {
        continue;
      }
      if (addedFirstVersion) {
        blockToAdd.validVersions[SupportedVersions[block_version].MCVersion] = `&${Object.keys(blockToAdd.validVersions)[0]}`;
      } else {
        blockToAdd.validVersions[SupportedVersions[block_version].MCVersion] = {
          NBTName: block_name_trimmed,
          NBTArgs: {},
        };
        for (const [nbtTag_key, nbtTag_value] of block_nbtTags) {
          const nbtTag_key_trimmed = nbtTag_key.trim();
          const nbtTag_value_trimmed = nbtTag_value.trim();
          if (!(nbtTag_key_trimmed === "" && nbtTag_value_trimmed === "")) {
            blockToAdd.validVersions[SupportedVersions[block_version].MCVersion].NBTArgs[nbtTag_key_trimmed] = nbtTag_value_trimmed;
          }
        }
        addedFirstVersion = true;
      }
    }

    const customBlocks = JSON.parse(CookieManager.getCookie("mapartcraft_customBlocks"));
    let customBlocks_new = customBlocks.filter(
      (customBlock) =>
        customBlock[0] !== block_colourSetId ||
        customBlock[1].displayName !== block_name_trimmed ||
        !Object.values(SupportedVersions).some(
          (supportedVersion_value) =>
            supportedVersion_value.MCVersion in customBlock[1].validVersions && supportedVersion_value.MCVersion in blockToAdd.validVersions
        )
    ); // filter removes customBlocks that have the same colourSet, name, and some versions in common as the one we are adding. For example this allows us to add different 1.12.2 and 1.13+ versions of a block
    customBlocks_new.push([block_colourSetId, blockToAdd]);

    this.setState((currentState) => {
      return { coloursJSON: this.getMergedColoursJSON(customBlocks_new), selectedBlocks: { ...currentState.selectedBlocks, [block_colourSetId]: "-1" } };
    });
    CookieManager.setCookie("mapartcraft_customBlocks", JSON.stringify(customBlocks_new));
  };

  handleDeleteCustomBlock = (block_colourSetId, block_name, block_versions) => {
    const block_name_trimmed = block_name.trim();
    if (block_name_trimmed === "" || Object.values(block_versions).every((t) => !t)) {
      return;
    }

    let validVersions = [];
    for (const [block_version, block_version_isSelected] of Object.entries(block_versions)) {
      if (block_version_isSelected) {
        validVersions.push(SupportedVersions[block_version].MCVersion);
      }
    }

    const customBlocks = JSON.parse(CookieManager.getCookie("mapartcraft_customBlocks"));
    let customBlocks_new = customBlocks.filter(
      (customBlock) =>
        customBlock[0] !== block_colourSetId ||
        customBlock[1].displayName !== block_name_trimmed ||
        !Object.values(SupportedVersions).some(
          (supportedVersion_value) =>
            supportedVersion_value.MCVersion in customBlock[1].validVersions && validVersions.includes(supportedVersion_value.MCVersion)
        )
    );

    this.setState((currentState) => {
      return {
        coloursJSON: this.getMergedColoursJSON(customBlocks_new),
        selectedBlocks: { ...currentState.selectedBlocks, [block_colourSetId]: "-1" },
        currentMaterialsData: {
          // reset currentMaterialsData as materials.js uses a cached version of materials which could contain blocks which no longer exist
          pixelsData: null,
          maps: [[]],
          currentSelectedBlocks: {},
        },
      };
    });
    CookieManager.setCookie("mapartcraft_customBlocks", JSON.stringify(customBlocks_new));
  };

  render() {
    const { getLocaleString } = this.props;
    const {
      coloursJSON,
      selectedBlocks,
      optionValue_version,
      optionValue_modeNBTOrMapdat,
      optionValue_mapSize_x,
      optionValue_mapSize_y,
      optionValue_cropImage,
      optionValue_cropImage_zoom,
      optionValue_cropImage_percent_x,
      optionValue_cropImage_percent_y,
      optionValue_showGridOverlay,
      optionValue_staircasing,
      optionValue_whereSupportBlocks,
      optionValue_supportBlock,
      optionValue_noSupportBlocksFirstRow,
      optionValue_transparency,
      optionValue_transparencyTolerance,
      optionValue_mapdatFilenameUseId,
      optionValue_mapdatFilenameIdStart,
      optionValue_betterColour,
      optionValue_dithering,
      optionValue_preprocessingEnabled,
      preProcessingValue_brightness,
      preProcessingValue_contrast,
      preProcessingValue_saturation,
      preProcessingValue_backgroundColourSelect,
      preProcessingValue_backgroundColour,
      optionValue_extras_moreStaircasingOptions,
      optionValue_minimumBlockCountEnabled,
      optionValue_minimumBlockCount,
      optionValue_staircaseYPositive,
      optionValue_staircaseYNegative,
      optionValue_staircaseYup,
      optionValue_staircaseYdown,
      mapPreviewRegenerateCounter,
      uploadedImage,
      uploadedImage_baseFilename,
      presets,
      selectedPresetName,
      currentMaterialsData,
      mapPreviewWorker_inProgress,
      viewOnline_NBT,
      viewOnline_3D,
    } = this.state;
    return (
      <div className="mapartController">
        <BlockSelection
          getLocaleString={getLocaleString}
          coloursJSON={coloursJSON}
          onChangeColourSetBlock={this.handleChangeColourSetBlock}
          optionValue_version={optionValue_version}
          optionValue_modeNBTOrMapdat={optionValue_modeNBTOrMapdat}
          optionValue_staircasing={optionValue_staircasing}
          effectiveToneKeys={this.getActiveToneKeys()}
          selectedBlocks={selectedBlocks}
          presets={presets}
          selectedPresetName={selectedPresetName}
          canDeletePreset={this.canDeletePreset}
          onPresetChange={this.handlePresetChange}
          onDeletePreset={this.handleDeletePreset}
          onSavePreset={this.handleSavePreset}
          onSharePreset={this.handleSharePreset}
          onGetPDNPaletteClicked={this.handleGetPDNPaletteClicked}
          onExportJSON={this.handleExportJSON}
          onImportJSON={this.handleImportJSONOpen}
          handleAddCustomBlock={this.handleAddCustomBlock}
          handleDeleteCustomBlock={this.handleDeleteCustomBlock}
        />
        {this.state.showingJSONExport && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
            onClick={this.handleExportJSONClose}
          >
            <div
              style={{ backgroundColor: "#222", padding: "1em", borderRadius: "0.5em", maxWidth: "90%", maxHeight: "90%", overflow: "auto" }}
              onClick={(e) => e.stopPropagation()}
            >
              <p>{getLocaleString("BLOCK-SELECTION/PRESETS/EXPORT-JSON-CLIPBOARD-COPIED")}</p>
              <textarea readOnly value={this.state.jsonExportText} style={{ width: "40em", height: "20em", maxWidth: "80vw" }} />
              <div style={{ textAlign: "right", marginTop: "0.5em" }}>
                <button type="button" onClick={this.handleExportJSONCopy}>
                  {getLocaleString("BLOCK-SELECTION/PRESETS/EXPORT-JSON-COPY")}
                </button>{" "}
                <button type="button" onClick={this.handleExportJSONClose}>
                  {getLocaleString("BLOCK-SELECTION/PRESETS/EXPORT-JSON-CLOSE")}
                </button>
              </div>
            </div>
          </div>
        )}
        {this.state.showingJSONImport && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
            onClick={this.handleImportJSONCancel}
          >
            <div
              style={{ backgroundColor: "#222", padding: "1em", borderRadius: "0.5em", maxWidth: "90%", maxHeight: "90%", overflow: "auto" }}
              onClick={(e) => e.stopPropagation()}
            >
              <p>{getLocaleString("BLOCK-SELECTION/PRESETS/IMPORT-JSON-TITLE")}</p>
              <textarea
                value={this.state.jsonImportText}
                onChange={this.handleImportJSONTextChange}
                placeholder={getLocaleString("BLOCK-SELECTION/PRESETS/IMPORT-JSON-PLACEHOLDER")}
                style={{ width: "40em", height: "20em", maxWidth: "80vw" }}
                autoFocus
              />
              <div style={{ textAlign: "right", marginTop: "0.5em" }}>
                <button type="button" onClick={this.handleImportJSONPaste}>
                  {getLocaleString("BLOCK-SELECTION/PRESETS/IMPORT-JSON-PASTE")}
                </button>{" "}
                <button type="button" onClick={this.handleImportJSONCancel}>
                  {getLocaleString("BLOCK-SELECTION/PRESETS/IMPORT-JSON-CANCEL")}
                </button>{" "}
                <button type="button" onClick={this.handleImportJSONApply}>
                  {getLocaleString("BLOCK-SELECTION/PRESETS/IMPORT-JSON-LOAD")}
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="sectionsPreviewSettingsMaterials">
          <MapPreview
            getLocaleString={getLocaleString}
            coloursJSON={coloursJSON}
            selectedBlocks={selectedBlocks}
            optionValue_version={optionValue_version}
            optionValue_modeNBTOrMapdat={optionValue_modeNBTOrMapdat}
            optionValue_mapSize_x={optionValue_mapSize_x}
            optionValue_mapSize_y={optionValue_mapSize_y}
            optionValue_cropImage={optionValue_cropImage}
            optionValue_cropImage_zoom={optionValue_cropImage_zoom}
            optionValue_cropImage_percent_x={optionValue_cropImage_percent_x}
            optionValue_cropImage_percent_y={optionValue_cropImage_percent_y}
            optionValue_showGridOverlay={optionValue_showGridOverlay}
            optionValue_staircasing={optionValue_staircasing}
            optionValue_whereSupportBlocks={optionValue_whereSupportBlocks}
            optionValue_transparency={optionValue_transparency}
            optionValue_transparencyTolerance={optionValue_transparencyTolerance}
            optionValue_betterColour={optionValue_betterColour}
            optionValue_dithering={optionValue_dithering}
            optionValue_preprocessingEnabled={optionValue_preprocessingEnabled}
            preProcessingValue_brightness={preProcessingValue_brightness}
            preProcessingValue_contrast={preProcessingValue_contrast}
            preProcessingValue_saturation={preProcessingValue_saturation}
            preProcessingValue_backgroundColourSelect={preProcessingValue_backgroundColourSelect}
            preProcessingValue_backgroundColour={preProcessingValue_backgroundColour}
            uploadedImage={uploadedImage}
            onFileDialogEvent={this.onFileDialogEvent}
            onGetMapMaterials={this.handleSetMapMaterials}
            onMapPreviewWorker_begin={this.onMapPreviewWorker_begin}
            mapPreviewRegenerateCounter={mapPreviewRegenerateCounter}
            effectiveToneKeys={this.getActiveToneKeys()}
            applyValleyOptimization={this.applyValleyOptimization()}
            optionValue_staircaseYup={optionValue_staircaseYPositive ? optionValue_staircaseYup : 0}
            optionValue_staircaseYdown={optionValue_staircaseYNegative ? optionValue_staircaseYdown : 0}
          />
          <div style={{ display: "block" }}>
            <MapSettings
              getLocaleString={getLocaleString}
              coloursJSON={coloursJSON}
              optionValue_version={optionValue_version}
              onOptionChange_version={this.onOptionChange_version}
              optionValue_modeNBTOrMapdat={optionValue_modeNBTOrMapdat}
              onOptionChange_modeNBTOrMapdat={this.onOptionChange_modeNBTOrMapdat}
              optionValue_mapSize_x={optionValue_mapSize_x}
              onOptionChange_mapSize_x={this.onOptionChange_mapSize_x}
              optionValue_mapSize_y={optionValue_mapSize_y}
              onOptionChange_mapSize_y={this.onOptionChange_mapSize_y}
              optionValue_cropImage={optionValue_cropImage}
              onOptionChange_cropImage={this.onOptionChange_cropImage}
              optionValue_cropImage_zoom={optionValue_cropImage_zoom}
              onOptionChange_cropImage_zoom={this.onOptionChange_cropImage_zoom}
              optionValue_cropImage_percent_x={optionValue_cropImage_percent_x}
              onOptionChange_cropImage_percent_x={this.onOptionChange_cropImage_percent_x}
              optionValue_cropImage_percent_y={optionValue_cropImage_percent_y}
              onOptionChange_cropImage_percent_y={this.onOptionChange_cropImage_percent_y}
              optionValue_showGridOverlay={optionValue_showGridOverlay}
              onOptionChange_showGridOverlay={this.onOptionChange_showGridOverlay}
              optionValue_staircasing={optionValue_staircasing}
              onOptionChange_staircasing={this.onOptionChange_staircasing}
              optionValue_staircaseYPositive={optionValue_staircaseYPositive}
              onOptionChange_staircaseYPositive={this.onOptionChange_staircaseYPositive}
              optionValue_staircaseYNegative={optionValue_staircaseYNegative}
              onOptionChange_staircaseYNegative={this.onOptionChange_staircaseYNegative}
              optionValue_staircaseYup={optionValue_staircaseYup}
              onOptionChange_staircaseYup={this.onOptionChange_staircaseYup}
              optionValue_staircaseYdown={optionValue_staircaseYdown}
              onOptionChange_staircaseYdown={this.onOptionChange_staircaseYdown}
              optionValue_whereSupportBlocks={optionValue_whereSupportBlocks}
              onOptionChange_WhereSupportBlocks={this.onOptionChange_WhereSupportBlocks}
              optionValue_supportBlock={optionValue_supportBlock}
              setOption_SupportBlock={this.setOption_SupportBlock}
              optionValue_noSupportBlocksFirstRow={optionValue_noSupportBlocksFirstRow}
              onOptionChange_noSupportBlocksFirstRow={this.onOptionChange_noSupportBlocksFirstRow}
              optionValue_transparency={optionValue_transparency}
              onOptionChange_transparency={this.onOptionChange_transparency}
              optionValue_transparencyTolerance={optionValue_transparencyTolerance}
              onOptionChange_transparencyTolerance={this.onOptionChange_transparencyTolerance}
              optionValue_mapdatFilenameUseId={optionValue_mapdatFilenameUseId}
              onOptionChange_mapdatFilenameUseId={this.onOptionChange_mapdatFilenameUseId}
              optionValue_mapdatFilenameIdStart={optionValue_mapdatFilenameIdStart}
              onOptionChange_mapdatFilenameIdStart={this.onOptionChange_mapdatFilenameIdStart}
              optionValue_betterColour={optionValue_betterColour}
              onOptionChange_BetterColour={this.onOptionChange_BetterColour}
              optionValue_dithering={optionValue_dithering}
              onOptionChange_dithering={this.onOptionChange_dithering}
              optionValue_preprocessingEnabled={optionValue_preprocessingEnabled}
              onOptionChange_PreProcessingEnabled={this.onOptionChange_PreProcessingEnabled}
              preProcessingValue_brightness={preProcessingValue_brightness}
              onOptionChange_PreProcessingBrightness={this.onOptionChange_PreProcessingBrightness}
              preProcessingValue_contrast={preProcessingValue_contrast}
              onOptionChange_PreProcessingContrast={this.onOptionChange_PreProcessingContrast}
              preProcessingValue_saturation={preProcessingValue_saturation}
              onOptionChange_PreProcessingSaturation={this.onOptionChange_PreProcessingSaturation}
              preProcessingValue_backgroundColourSelect={preProcessingValue_backgroundColourSelect}
              onOptionChange_PreProcessingBackgroundColourSelect={this.onOptionChange_PreProcessingBackgroundColourSelect}
              preProcessingValue_backgroundColour={preProcessingValue_backgroundColour}
              onOptionChange_PreProcessingBackgroundColour={this.onOptionChange_PreProcessingBackgroundColour}
              optionValue_extras_moreStaircasingOptions={optionValue_extras_moreStaircasingOptions}
              onOptionChange_extras_moreStaircasingOptions={this.onOptionChange_extras_moreStaircasingOptions}
              optionValue_minimumBlockCountEnabled={optionValue_minimumBlockCountEnabled}
              onOptionChange_minimumBlockCountEnabled={this.onOptionChange_minimumBlockCountEnabled}
              optionValue_minimumBlockCount={optionValue_minimumBlockCount}
              onOptionChange_minimumBlockCount={this.onOptionChange_minimumBlockCount}
            />
            <GreenButtons
              getLocaleString={getLocaleString}
              coloursJSON={coloursJSON}
              selectedBlocks={selectedBlocks}
              optionValue_version={optionValue_version}
              optionValue_modeNBTOrMapdat={optionValue_modeNBTOrMapdat}
              optionValue_mapSize_x={optionValue_mapSize_x}
              optionValue_mapSize_y={optionValue_mapSize_y}
              optionValue_cropImage={optionValue_cropImage}
              optionValue_cropImage_zoom={optionValue_cropImage_zoom}
              optionValue_cropImage_percent_x={optionValue_cropImage_percent_x}
              optionValue_cropImage_percent_y={optionValue_cropImage_percent_y}
              optionValue_staircasing={optionValue_staircasing}
              optionValue_whereSupportBlocks={optionValue_whereSupportBlocks}
              optionValue_supportBlock={optionValue_supportBlock}
              optionValue_noSupportBlocksFirstRow={optionValue_noSupportBlocksFirstRow}
              optionValue_transparency={optionValue_transparency}
              optionValue_transparencyTolerance={optionValue_transparencyTolerance}
              optionValue_mapdatFilenameUseId={optionValue_mapdatFilenameUseId}
              optionValue_mapdatFilenameIdStart={optionValue_mapdatFilenameIdStart}
              optionValue_betterColour={optionValue_betterColour}
              optionValue_dithering={optionValue_dithering}
              optionValue_preprocessingEnabled={optionValue_preprocessingEnabled}
              preProcessingValue_brightness={preProcessingValue_brightness}
              preProcessingValue_contrast={preProcessingValue_contrast}
              preProcessingValue_saturation={preProcessingValue_saturation}
              preProcessingValue_backgroundColourSelect={preProcessingValue_backgroundColourSelect}
              preProcessingValue_backgroundColour={preProcessingValue_backgroundColour}
              uploadedImage={uploadedImage}
              uploadedImage_baseFilename={uploadedImage_baseFilename}
              currentMaterialsData={currentMaterialsData}
              mapPreviewWorker_inProgress={mapPreviewWorker_inProgress}
              downloadBlobFile={this.downloadBlobFile}
              onGetViewOnlineNBT={this.onGetViewOnlineNBT}
            />
          </div>
          {optionValue_modeNBTOrMapdat === MapModes.SCHEMATIC_NBT.uniqueId ? (
            <Materials
              getLocaleString={getLocaleString}
              coloursJSON={coloursJSON}
              optionValue_version={optionValue_version}
              optionValue_supportBlock={optionValue_supportBlock}
              currentMaterialsData={currentMaterialsData}
              selectedBlocks={selectedBlocks}
              onChangeColourSetBlock={this.handleChangeColourSetBlock}
            />
          ) : null}
        </div>
        {viewOnline_NBT !== null &&
          (viewOnline_3D ? (
            <ViewOnline3D
              getLocaleString={getLocaleString}
              coloursJSON={coloursJSON}
              optionValue_version={optionValue_version}
              optionValue_mapSize_x={optionValue_mapSize_x}
              optionValue_mapSize_y={optionValue_mapSize_y}
              viewOnline_NBT={viewOnline_NBT}
              handleViewOnline3DEscape={this.handleViewOnline3DEscape}
            />
          ) : (
            <ViewOnline2D
              getLocaleString={getLocaleString}
              coloursJSON={coloursJSON}
              optionValue_version={optionValue_version}
              optionValue_mapSize_x={optionValue_mapSize_x}
              optionValue_mapSize_y={optionValue_mapSize_y}
              optionValue_staircasing={optionValue_staircasing}
              viewOnline_NBT={viewOnline_NBT}
              onGetViewOnlineNBT={this.onGetViewOnlineNBT}
              onChooseViewOnline3D={this.onChooseViewOnline3D}
            />
          ))}
      </div>
    );
  }
}

export default MapartController;
