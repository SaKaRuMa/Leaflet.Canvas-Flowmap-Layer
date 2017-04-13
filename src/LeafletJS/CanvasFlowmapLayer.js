var canvasRenderer = L.canvas();

L.CanvasFlowmapLayer = L.GeoJSON.extend({
  options: {
    // this is only a default option example
    // developers will need to provide this with values unique to their data
    originAndDestinationFieldIds: {
      originUniqueIdField: 'origin_id',
      originGeometry: {
        x: 'origin_lon',
        y: 'origin_lat'
      },
      destinationUniqueIdField: 'destination_id',
      destinationGeometry: {
        x: 'destination_lon',
        y: 'destination_lat'
      }
    },

    canvasBezierStyle: {
      type: 'simple',
      symbol: {
        // use canvas styling options (compare to styling circle markers below)
        strokeStyle: 'rgba(255, 0, 51, 0.8)',
        lineWidth: 0.75,
        lineCap: 'round',
        shadowColor: 'rgb(255, 0, 51)',
        shadowBlur: 1.5
      }
    },

    // valid values: 'selection' or 'all'
    // use 'all' to display all Bezier paths immediately
    // use 'selection' if Bezier paths will be drawn with user interactions
    pathDisplayMode: 'all',

    wrapAroundCanvas: true,

    pointToLayer: function(geoJsonPoint, latlng) {
      return L.circleMarker(latlng);
    },

    style: function(geoJsonFeature) {
      // use leaflet's path styling options
      if (geoJsonFeature.properties.isOrigin) {
        // developers can rely on the "isOrigin" property to set different symbols
        // for origin and destination circle markers
        return {
          renderer: canvasRenderer,
          radius: 5,
          weight: 1,
          color: 'rgb(195, 255, 62)',
          fillColor: 'rgba(195, 255, 62, 0.6)',
          fillOpacity: 0.6
        };
      } else {
        return {
          renderer: canvasRenderer,
          radius: 2.5,
          weight: 0.25,
          color: 'rgb(17, 142, 170)',
          fillColor: 'rgb(17, 142, 170)',
          fillOpacity: 0.7
        };
      }
    }
  },

  initialize: function(geojson, options) {
    L.setOptions(this, options);

    this._layers = {};

    // same as L.GeoJSON intialize method, but first performs custom geojson
    // data parsing and reformatting before eventually calling addData method
    if (geojson && this.options.originAndDestinationFieldIds) {
      this.setOriginAndDestinationGeoJsonPoints(geojson);
    }
  },

  setOriginAndDestinationGeoJsonPoints: function(geoJsonFeatureCollection) {
    if (geoJsonFeatureCollection.features) {
      var configOriginGeometryObject = this.options.originAndDestinationFieldIds.originGeometry;
      var configDestinationGeometryObject = this.options.originAndDestinationFieldIds.destinationGeometry;

      geoJsonFeatureCollection.features.forEach(function(feature, index) {
        if (feature.type === 'Feature' && feature.geometry && feature.geometry.type === 'Point') {
          // origin feature -- modify attributes and geometry
          feature.properties.isOrigin = true;
          feature.properties._isSelectedForPathDisplay = this.options.pathDisplayMode === 'all' ? true : false;
          feature.properties._uniqueId = index + '_origin';

          feature.geometry.coordinates = [
            feature.properties[configOriginGeometryObject.x],
            feature.properties[configOriginGeometryObject.y]
          ];

          // destination feature -- clone, modify, and push to feature collection
          var destinationFeature = JSON.parse(JSON.stringify(feature));

          destinationFeature.properties.isOrigin = false;
          destinationFeature.properties._isSelectedForPathDisplay = false;
          destinationFeature.properties._uniqueId = index + '_destination';

          destinationFeature.geometry.coordinates = [
            destinationFeature.properties[configDestinationGeometryObject.x],
            destinationFeature.properties[configDestinationGeometryObject.y]
          ];

          geoJsonFeatureCollection.features.push(destinationFeature);
        }
      }, this);

      // all origin/destination features are available for future internal used
      // but only a filtered subset of these are drawn on the map
      this.originAndDestinationGeoJsonPoints = geoJsonFeatureCollection;
      var geoJsonPointsToDraw = this._filterGeoJsonPointsToDraw(geoJsonFeatureCollection);
      this.addData(geoJsonPointsToDraw);
    } else {
      // TODO: improved handling of invalid incoming GeoJson FeatureCollection?
      this.originAndDestinationGeoJsonPoints = null;
    }

    return this;
  },

  _filterGeoJsonPointsToDraw: function(geoJsonFeatureCollection) {
    var newGeoJson = {
      type: 'FeatureCollection',
      features: []
    };

    var originUniqueIdValues = [];
    var destinationUniqueIdValues = [];

    var originUniqueIdField = this.options.originAndDestinationFieldIds.originUniqueIdField;
    var destinationUniqueIdField = this.options.originAndDestinationFieldIds.destinationUniqueIdField;

    geoJsonFeatureCollection.features.forEach(function(feature) {
      var isOrigin = feature.properties.isOrigin;

      if (isOrigin && originUniqueIdValues.indexOf(feature.properties[originUniqueIdField]) === -1) {
        originUniqueIdValues.push(feature.properties[originUniqueIdField]);
        newGeoJson.features.push(feature);
      } else if (!isOrigin && destinationUniqueIdValues.indexOf(feature.properties[destinationUniqueIdField]) === -1) {
        destinationUniqueIdValues.push(feature.properties[destinationUniqueIdField]);
        newGeoJson.features.push(feature);
      } else {
        // do not attempt to draw an origin or destination circle on the canvas if it is already in one of the tracking arrays
        return;
      }
    });

    return newGeoJson;
  },

  onAdd: function(map) {
    // call the L.GeoJSON onAdd method,
    // then continue with custom code
    L.GeoJSON.prototype.onAdd.call(this, map);

    // create new canvas element just for manually drawing bezier curves
    this._canvasElement = L.DomUtil.create('canvas', 'leaflet-zoom-animated');

    var originProp = L.DomUtil.testProp(['transformOrigin', 'WebkitTransformOrigin', 'msTransformOrigin']);
    this._canvasElement.style[originProp] = '50% 50%';

    var pane = map.getPane(this.options.pane);
    pane.insertBefore(this._canvasElement, pane.firstChild);

    this.on('click mouseover', this._modifyInteractionEvent, this);
    map.on('move', this._resetCanvas, this);
    map.on('moveend', this._resetCanvasAndWrapGeoJsonCircleMarkers, this);
    map.on('resize', this._resizeCanvas, this);
    if (map.options.zoomAnimation && L.Browser.any3d) {
      map.on('zoomanim', this._animateZoom, this);
    }

    // calculate initial size and position of canvas
    // and draw its content for the first time
    this._resizeCanvas();
    this._resetCanvas();
  },

  onRemove: function(map) {
    // call the L.GeoJSON onRemove method,
    // then continue with custom code
    L.GeoJSON.prototype.onRemove.call(this, map);

    L.DomUtil.remove(this._canvasElement);

    this.off('click mouseover', this._modifyInteractionEvent, this);
    map.off('move', this._resetCanvas, this);
    map.off('moveend', this._resetCanvasAndWrapGeoJsonCircleMarkers, this);
    map.off('resize', this._resizeCanvas, this);
    if (map.options.zoomAnimation) {
      map.off('zoomanim', this._animateZoom, this);
    }
  },

  _modifyInteractionEvent: function(e) {
    var odInfo = this._getSharedOriginOrDestinationFeatures(e.layer.feature);
    e.isOriginFeature = odInfo.isOriginFeature;
    e.sharedOriginFeatures = odInfo.sharedOriginFeatures;
    e.sharedDestinationFeatures = odInfo.sharedDestinationFeatures;
  },

  _getSharedOriginOrDestinationFeatures: function(testFeature) {
    var isOriginFeature = testFeature.properties.isOrigin;
    var sharedOriginFeatures = [];
    var sharedDestinationFeatures = [];

    if (isOriginFeature) {
      // for an ORIGIN point that was interacted with,
      // make an array of all other ORIGIN features with the same ORIGIN ID field
      var originUniqueIdField = this.options.originAndDestinationFieldIds.originUniqueIdField;
      var testFeatureOriginId = testFeature.properties[originUniqueIdField];
      sharedOriginFeatures = this.originAndDestinationGeoJsonPoints.features.filter(function(feature) {
        return feature.properties.isOrigin &&
          feature.properties[originUniqueIdField] === testFeatureOriginId;
      });
    } else {
      // for a DESTINATION point that was interacted with,
      // make an array of all other ORIGIN features with the same DESTINATION ID field
      var destinationUniqueIdField = this.options.originAndDestinationFieldIds.destinationUniqueIdField;
      var testFeatureDestinationId = testFeature.properties[destinationUniqueIdField];
      sharedDestinationFeatures = this.originAndDestinationGeoJsonPoints.features.filter(function(feature) {
        return feature.properties.isOrigin &&
          feature.properties[destinationUniqueIdField] === testFeatureDestinationId;
      });
    }

    return {
      isOriginFeature: isOriginFeature, // Boolean
      sharedOriginFeatures: sharedOriginFeatures, // Array of features
      sharedDestinationFeatures: sharedDestinationFeatures // Array of features
    };
  },

  selectFeaturesForPathDisplay: function(selectionFeatures, selectionMode) {
    this._applyFeaturesSelection(selectionFeatures, selectionMode, '_isSelectedForPathDisplay');
  },

  _applyFeaturesSelection: function(selectionFeatures, selectionMode, selectionAttributeName) {
    var selectionIds = selectionFeatures.map(function(feature) {
      return feature.properties._uniqueId;
    });

    if (selectionMode === 'SELECTION_NEW') {
      this.originAndDestinationGeoJsonPoints.features.forEach(function(feature) {
        if (selectionIds.indexOf(feature.properties._uniqueId) > -1) {
          feature.properties[selectionAttributeName] = true;
        } else {
          feature.properties[selectionAttributeName] = false;
        }
      });
    } else if (selectionMode === 'SELECTION_ADD') {
      this.originAndDestinationGeoJsonPoints.features.forEach(function(feature) {
        if (selectionIds.indexOf(feature.properties._uniqueId) > -1) {
          feature.properties[selectionAttributeName] = true;
        }
      });
    } else if (selectionMode === 'SELECTION_SUBTRACT') {
      this.originAndDestinationGeoJsonPoints.features.forEach(function(feature) {
        if (selectionIds.indexOf(feature.properties._uniqueId) > -1) {
          feature.properties[selectionAttributeName] = false;
        }
      });
    } else {
      return;
    }

    this._resetCanvas();
  },

  _animateZoom: function(e) {
    // see: https://github.com/Leaflet/Leaflet.heat
    var scale = this._map.getZoomScale(e.zoom);
    var offset = this._map._getCenterOffset(e.center)._multiplyBy(-scale).subtract(this._map._getMapPanePos());

    if (L.DomUtil.setTransform) {
      L.DomUtil.setTransform(this._canvasElement, offset, scale);
    } else {
      this._canvasElement.style[L.DomUtil.TRANSFORM] = L.DomUtil.getTranslateString(offset) + ' scale(' + scale + ')';
    }
  },

  _resizeCanvas: function() {
    // update the canvas size
    var size = this._map.getSize();
    this._canvasElement.width = size.x;
    this._canvasElement.height = size.y;
    this._resetCanvas();
  },

  _resetCanvas: function() {
    // update the canvas position and redraw its content
    var topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvasElement, topLeft);
    this._redrawCanvas();
  },

  _resetCanvasAndWrapGeoJsonCircleMarkers: function() {
    this._resetCanvas();
    // Leaflet will redraw every circle marker when its latLng is changed
    // sometimes they are drawn 2+ times if this occurs during many "move" events
    // so for now, only change the circle markers after a "moveend" event
    this._wrapGeoJsonCircleMarkers();
  },

  _wrapGeoJsonCircleMarkers: function() {
    // ensure that the GeoJson point features,
    // which are drawn on the map as individual CircleMarker layers,
    // will be drawn beyond +/-180 longitude
    this.eachLayer(function(layer) {
      var wrappedLatLng = this._wrapAroundLatLng(layer.getLatLng());
      layer.setLatLng(wrappedLatLng);
    }, this);
  },

  _redrawCanvas: function() {
    // draw canvas content (only the Bezier curves)
    if (this.originAndDestinationGeoJsonPoints) {
      this._clearCanvas();
      // loop over each of the "selected" features and re-draw the canvas paths
      this._drawSelectedCanvasPaths(false);
    }
  },

  _clearCanvas: function() {
    this._canvasElement.getContext('2d')
      .clearRect(0, 0, this._canvasElement.width, this._canvasElement.height);
  },

  _drawSelectedCanvasPaths: function( /*animate*/ ) {
    // var ctx = animate ? this._animationCanvasElement.getContext('2d') : this._canvasElement.getContext('2d');
    var ctx = this._canvasElement.getContext('2d');
    ctx.beginPath();

    var originAndDestinationFieldIds = this.options.originAndDestinationFieldIds;

    this.originAndDestinationGeoJsonPoints.features.forEach(function(feature) {

      if (feature.properties._isSelectedForPathDisplay) {
        var originXCoordinate = feature.properties[originAndDestinationFieldIds.originGeometry.x];
        var originYCoordinate = feature.properties[originAndDestinationFieldIds.originGeometry.y];
        var destinationXCoordinate = feature.properties[originAndDestinationFieldIds.destinationGeometry.x];
        var destinationYCoordinate = feature.properties[originAndDestinationFieldIds.destinationGeometry.y];

        // origin and destination points for drawing curved lines
        // ensure that canvas features will be drawn beyond +/-180 longitude
        var originLatLng = this._wrapAroundLatLng(L.latLng([originYCoordinate, originXCoordinate]));
        var destinationLatLng = this._wrapAroundLatLng(L.latLng([destinationYCoordinate, destinationXCoordinate]));

        // convert geometry to screen coordinates for canvas drawing
        var screenOriginPoint = this._map.latLngToContainerPoint(originLatLng);
        var screenDestinationPoint = this._map.latLngToContainerPoint(destinationLatLng);

        // get the canvas symbol properties,
        // and draw a curved canvas line

        // var symbol;
        // if (animate) {
        //   symbol = this._getSymbolProperties(feature, this.animatePathProperties);
        //   this._animateCanvasLineSymbol(ctx, symbol, screenOriginPoint, screenDestinationPoint);
        // } else {
        //   symbol = this._getSymbolProperties(feature, this.pathProperties);
        //   this._applyCanvasLineSymbol(ctx, symbol, screenOriginPoint, screenDestinationPoint);
        // }

        var symbol = this._getSymbolProperties(feature, this.options.canvasBezierStyle);
        this._applyCanvasLineSymbol(ctx, symbol, screenOriginPoint, screenDestinationPoint);
      }
    }, this);

    ctx.stroke();
    ctx.closePath();
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

  _applyCanvasLineSymbol: function(ctx, symbolObject, screenOriginPoint, screenDestinationPoint) {
    ctx.lineCap = symbolObject.lineCap;
    ctx.lineWidth = symbolObject.lineWidth;
    ctx.strokeStyle = symbolObject.strokeStyle;
    ctx.shadowBlur = symbolObject.shadowBlur;
    ctx.shadowColor = symbolObject.shadowColor;
    ctx.moveTo(screenOriginPoint.x, screenOriginPoint.y);
    ctx.bezierCurveTo(screenOriginPoint.x, screenDestinationPoint.y, screenDestinationPoint.x, screenDestinationPoint.y, screenDestinationPoint.x, screenDestinationPoint.y);
  },

  _wrapAroundLatLng: function(latLng) {
    if (this.options.wrapAroundCanvas) {
      var wrappedLatLng = latLng.clone();
      var mapCenterLng = this._map.getCenter().lng;
      var wrapAroundDiff = mapCenterLng - wrappedLatLng.lng;
      if (wrapAroundDiff < -180 || wrapAroundDiff > 180) {
        wrappedLatLng.lng += (Math.round(wrapAroundDiff / 360) * 360);
      }
      return wrappedLatLng;
    } else {
      return latLng;
    }
  }
});

L.canvasFlowmapLayer = function(originAndDestinationGeoJsonPoints, opts) {
  return new L.CanvasFlowmapLayer(originAndDestinationGeoJsonPoints, opts);
};
