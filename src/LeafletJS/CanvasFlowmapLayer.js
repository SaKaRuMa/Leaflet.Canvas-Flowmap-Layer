L.CanvasFlowmapLayer = L.Layer.extend({
  originAndDestinationPointGeoJSON: null,

  _originAndDestinationFeatures: [],

  options: {
    originAndDestinationFieldIds: null,
    originCircleProperties: {
      type: 'simple',
      symbol: {
        globalCompositeOperation: 'destination-over',
        radius: 5,
        fillStyle: 'rgba(195, 255, 62, 0.60)',
        lineWidth: 1,
        strokeStyle: 'rgb(195, 255, 62)',
        shadowBlur: 0
      }
    },
    destinationCircleProperties: {
      type: 'simple',
      symbol: {
        globalCompositeOperation: 'destination-over',
        radius: 2.5,
        fillStyle: 'rgba(17, 142, 170, 0.7)',
        lineWidth: 0.25,
        strokeStyle: 'rgb(17, 142, 170)',
        shadowBlur: 0
      }
    }
  },

  initialize: function(originAndDestinationPointGeoJSON, options) {
    this.originAndDestinationPointGeoJSON = originAndDestinationPointGeoJSON;

    L.setOptions(this, options);

    if (this.originAndDestinationPointGeoJSON && this.originAndDestinationPointGeoJSON.features) {
      var configOriginGeometryObject = this.options.originAndDestinationFieldIds.originGeometry;
      var configDestinationGeometryObject = this.options.originAndDestinationFieldIds.destinationGeometry;

      this.originAndDestinationPointGeoJSON.features.forEach(function(feature, index) {
        if (feature.type === 'Feature' && feature.geometry && feature.geometry.type === 'Point') {

          // origin feature
          feature.properties._isOrigin = true;
          feature.properties._isSelectedForPathDisplay = false;
          feature.properties._isSelectedForPathHighlight = false;
          feature.properties._uniqueId = index + '_o';

          feature.geometry.coordinates = [
            feature.properties[configOriginGeometryObject.y],
            feature.properties[configOriginGeometryObject.x]
          ];

          // destination feature -- clone, modify, and push to feature collection
          var destinationFeature = JSON.parse(JSON.stringify(feature));

          destinationFeature.properties._isOrigin = false;
          destinationFeature.properties._isSelectedForPathDisplay = false;
          destinationFeature.properties._isSelectedForPathHighlight = false;
          destinationFeature.properties._uniqueId = index + '_d';

          destinationFeature.geometry.coordinates = [
            destinationFeature.properties[configDestinationGeometryObject.y],
            destinationFeature.properties[configDestinationGeometryObject.x]
          ];

          this.originAndDestinationPointGeoJSON.features.push(destinationFeature);
        }
      }, this);
    }
  },

  onAdd: function(map) {
    var pane = map.getPane(this.options.pane);

    this._canvasTop = L.DomUtil.create('canvas', 'leaflet-layer');
    var originProp = L.DomUtil.testProp(['transformOrigin', 'WebkitTransformOrigin', 'msTransformOrigin']);
    this._canvasTop.style[originProp] = '50% 50%';

    pane.appendChild(this._canvasTop);

    map.on('zoomstart', this._clearCanvas, this);
    map.on('moveend', this._resetCanvas, this);
    map.on('resize', this._resizeCanvas, this);

    // Calculate initial size and position of canvas
    this._resizeCanvas();
    this._resetCanvas();
  },

  onRemove: function(map) {
    L.DomUtil.remove(this._canvasTop);
    map.off('zoomstart', this._clearCanvas, this);
    map.off('moveend', this._resetCanvas, this);
    map.off('resize', this._resizeCanvas, this);
  },

  _clearCanvas: function() {
    this._canvasTop.getContext('2d').clearRect(0, 0, this._canvasTop.width, this._canvasTop.height);
  },

  _resizeCanvas: function() {
    var size = this._map.getSize();
    this._canvasTop.width = size.x;
    this._canvasTop.height = size.y;
  },

  _resetCanvas: function() {
    var topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvasTop, topLeft);

    this._redrawCanvas();
  },


  _redrawCanvas: function() {
    if (this.originAndDestinationPointGeoJSON) {
      this._clearCanvas();
      this._drawAllCanvasPoints();
    }
  },

  _drawAllCanvasPoints: function() {
    var ctx = this._canvasTop.getContext('2d');

    // reset temporary tracking arrays to make sure only 1 copy of each origin or destination point gets drawn on the canvas
    var originUniqueIdValues = [];
    var destinationUniqueIdValues = [];

    var originUniqueIdField = this.options.originAndDestinationFieldIds.originUniqueIdField;
    var destinationUniqueIdField = this.options.originAndDestinationFieldIds.destinationUniqueIdField;

    this.originAndDestinationPointGeoJSON.features.forEach(function(feature) {
      var isOrigin = feature.properties._isOrigin;
      var canvasCircleProperties;

      if (isOrigin && originUniqueIdValues.indexOf(feature.properties[originUniqueIdField]) === -1) {
        originUniqueIdValues.push(feature.properties[originUniqueIdField]);
        canvasCircleProperties = feature.properties._isSelectedForHighlight ? this.options.originHighlightCircleProperties : this.options.originCircleProperties;
      } else if (!isOrigin && destinationUniqueIdValues.indexOf(feature.properties[destinationUniqueIdField]) === -1) {
        destinationUniqueIdValues.push(feature.properties[destinationUniqueIdField]);
        canvasCircleProperties = feature.properties._isSelectedForHighlight ? this.options.destinationHighlightCircleProperties : this.options.destinationCircleProperties;
      } else {
        // do not attempt to draw an origin or destination circle on the canvas if it is already in one of the tracking arrays
        return;
      }

      // ensure that canvas features will be drawn beyond +/-180 longitude
      // var geometry = this._wrapAroundCanvasPointGeometry(feature.geometry);

      // convert geometry to screen coordinates for canvas drawing
      // var screenPoint = this._map.toScreen(geometry);
      // var screenPoint = L.CRS.EPSG3857.latLngToPoint(L.latLng(feature.geometry.coordinates), this._map.getZoom());
      var screenPoint = this._map.latLngToContainerPoint(L.latLng(feature.geometry.coordinates));

      // get the canvas symbol properties
      var symbol = this._getSymbolProperties(feature, canvasCircleProperties);

      // draw a circle point on the canvas
      this._applyCanvasPointSymbol(ctx, symbol, screenPoint);
    }, this);
  },

  _getSymbolProperties: function(feature, canvasSymbolConfig) {
    // get the canvas symbol properties
    var symbol;
    var filteredSymbols;
    if (canvasSymbolConfig.type === 'simple') {
      symbol = canvasSymbolConfig.symbol;
    } else if (canvasSymbolConfig.type === 'uniqueValue') {
      filteredSymbols = canvasSymbolConfig.uniqueValueInfos.filter(function(info) {
        return info.value === feature.properties[canvasSymbolConfig.field];
      });
      symbol = filteredSymbols[0].symbol;
    } else if (canvasSymbolConfig.type === 'classBreaks') {
      filteredSymbols = canvasSymbolConfig.classBreakInfos.filter(function(info) {
        return (
          info.classMinValue <= feature.properties[canvasSymbolConfig.field] &&
          info.classMaxValue >= feature.properties[canvasSymbolConfig.field]
        );
      });
      if (filteredSymbols.length) {
        symbol = filteredSymbols[0].symbol;
      } else {
        symbol = canvasSymbolConfig.defaultSymbol;
      }
    }
    return symbol;
  },

  _applyCanvasPointSymbol: function(ctx, symbolObject, screenPoint) {
    ctx.globalCompositeOperation = symbolObject.globalCompositeOperation;
    ctx.fillStyle = symbolObject.fillStyle;
    ctx.lineWidth = symbolObject.lineWidth;
    ctx.strokeStyle = symbolObject.strokeStyle;
    ctx.shadowBlur = symbolObject.shadowBlur;
    ctx.beginPath();
    ctx.arc(screenPoint.x, screenPoint.y, symbolObject.radius, 0, 2 * Math.PI, false);
    ctx.fill();
    ctx.stroke();
    ctx.closePath();
  },
});

L.canvasFlowmapLayer = function(originAndDestinationPointGeoJSON, opts) {
  return new L.CanvasFlowmapLayer(originAndDestinationPointGeoJSON, opts);
};
