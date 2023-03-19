'use strict';

var L = require('leaflet');
var Geocoder = require('leaflet-control-geocoder');
var LRM = require('leaflet-routing-machine');
var locate = require('leaflet.locatecontrol');
var options = require('./lrm_options');
var links = require('./links');
var leafletOptions = require('./leaflet_options');
var ls = require('local-storage');
var tools = require('./tools');
var state = require('./state');
var localization = require('./localization');
require('./polyfill');

var parsedOptions = links.parse(window.location.search.slice(1));
var mergedOptions = L.extend(leafletOptions.defaultState, parsedOptions);
var local = localization.get(mergedOptions.language);

// load only after language was chosen
var itineraryBuilder = require('./itinerary_builder')(mergedOptions.language);

var mapLayer = leafletOptions.layer;
var overlay = leafletOptions.overlay;
var baselayer = ls.get('layer') ? mapLayer[0][ls.get('layer')] : leafletOptions.defaultState.layer;
var layers = ls.get('getOverlay') && [baselayer, overlay['Small Components']] || baselayer;
var map = L.map('map', {
  zoomControl: true,
  dragging: true,
  layers: layers,
  maxZoom: 18
}).setView(mergedOptions.center, mergedOptions.zoom);

// Pass basemap layers
mapLayer = mapLayer.reduce(function(title, layer) {
  title[layer.label] = L.tileLayer(layer.tileLayer, {
    id: layer.label
  });
  return title;
});

/* Leaflet Controls */
L.control.layers(mapLayer, overlay, {
  position: 'bottomright'
}).addTo(map);

L.control.scale().addTo(map);

/* Store User preferences */
// store baselayer changes
map.on('baselayerchange', function(e) {
  ls.set('layer', e.name);
});
// store overlay add or remove
map.on('overlayadd', function(e) {
  ls.set('getOverlay', true);
});
map.on('overlayremove', function(e) {
  ls.set('getOverlay', false);
});

/* OSRM setup */
var ReversablePlan = L.Routing.Plan.extend({
  createGeocoders: function() {
    var container = L.Routing.Plan.prototype.createGeocoders.call(this);
    return container;
  }
});


/* Setup markers */
function makeIcon(i, n) {
  var url = 'images/marker-via-icon-2x.png';
  var markerList = ['images/saferwalk-start-icon.png', 'images/saferwalk-end-icon.png'];
  if (i === 0) {
    return L.icon({
      iconUrl: markerList[0],
      iconSize: [44, 44],
      iconAnchor: [10, 28]
    });
  }

  if (i === n - 1) {
    return L.icon({
      iconUrl: markerList[1],
      iconSize: [30, 50],
      iconAnchor: [10, 28]
    });
  } else {
    return L.icon({
      iconUrl: url,
      iconSize: [20, 56],
      iconAnchor: [10, 28]
    });
  }
}

var plan = new ReversablePlan([], {
  geocoder: Geocoder.nominatim(),
  routeWhileDragging: true,
  createMarker: function(i, wp, n) {
    var options = {
      draggable: this.draggableWaypoints,
      icon: makeIcon(i, n)
    };
    var marker = L.marker(wp.latLng, options);
    marker.on('click', function() {
      plan.spliceWaypoints(i, 1);
    });
    return marker;
  },
  routeDragInterval: options.lrm.routeDragInterval,
  addWaypoints: true,
  waypointMode: 'snap',
  position: 'topright',
  useZoomParameter: options.lrm.useZoomParameter,
  reverseWaypoints: true,
  dragStyles: options.lrm.dragStyles,
  geocodersClassName: options.lrm.geocodersClassName, // here
  geocoderPlaceholder: function(i, n) {
    var startend = [local['Start - press enter to drop marker'], local['End - press enter to drop marker']];
    var via = [local['Via point - press enter to drop marker']];
    if (i === 0) {
      return startend[0];
    }
    if (i === (n - 1)) {
      return startend[1];
    } else {
      return via;
    }
  }
});

L.extend(L.Routing, itineraryBuilder);

// add marker labels
var controlOptions = {
  plan: plan,
  routeWhileDragging: options.lrm.routeWhileDragging,
  lineOptions: options.lrm.lineOptions,
  altLineOptions: options.lrm.altLineOptions,
  summaryTemplate: options.lrm.summaryTemplate,
  containerClassName: options.lrm.containerClassName,
  alternativeClassName: options.lrm.alternativeClassName,
  stepClassName: options.lrm.stepClassName,
  language: 'en', // we are injecting own translations via osrm-text-instructions
  showAlternatives: options.lrm.showAlternatives,
  units: mergedOptions.units,
  serviceUrl: leafletOptions.services[0].path,
  useZoomParameter: options.lrm.useZoomParameter,
  routeDragInterval: options.lrm.routeDragInterval,
  collapsible: options.lrm.collapsible
};

var controlOptionsCustom = {
  plan: plan,
  routeWhileDragging: options.lrm.routeWhileDragging,
  lineOptions: options.lrm.lineOptions,
  altLineOptions: options.lrm.altLineOptions,
  summaryTemplate: options.lrm.summaryTemplate,
  containerClassName: options.lrm.containerClassName,
  alternativeClassName: options.lrm.alternativeClassName,
  stepClassName: options.lrm.stepClassName,
  language: 'en', // we are injecting own translations via osrm-text-instructions
  showAlternatives: options.lrm.showAlternatives,
  units: mergedOptions.units,
  serviceUrl: leafletOptions.services[0].pathCustom,
  useZoomParameter: options.lrm.useZoomParameter,
  routeDragInterval: options.lrm.routeDragInterval,
  collapsible: options.lrm.collapsible
};

var router = (new L.Routing.OSRMv1(controlOptions));
var routerCustom = (new L.Routing.OSRMv1(controlOptionsCustom));

router._convertRouteOriginal = router._convertRoute;
router._convertRoute = function(responseRoute) {
  // monkey-patch L.Routing.OSRMv1 until it's easier to overwrite with a hook
  var resp = this._convertRouteOriginal(responseRoute);

  if (resp.instructions && resp.instructions.length) {
    var i = 0;
    responseRoute.legs.forEach(function(leg) {
      leg.steps.forEach(function(step) {
        // abusing the text property to save the original osrm step
        // for later use in the itnerary builder
        resp.instructions[i].text = step;
        i++;
      });
    });
  };

  return resp;
};

routerCustom._convertRouteOriginal = routerCustom._convertRoute;
routerCustom._convertRoute = function(responseRoute) {
  // monkey-patch L.Routing.OSRMv1 until it's easier to overwrite with a hook
  var resp = this._convertRouteOriginal(responseRoute);

  if (resp.instructions && resp.instructions.length) {
    var i = 0;
    responseRoute.legs.forEach(function(leg) {
      leg.steps.forEach(function(step) {
        // abusing the text property to save the original osrm step
        // for later use in the itnerary builder
        resp.instructions[i].text = step;
        i++;
      });
    });
  };

  return resp;
};

var lrmControl = L.Routing.control(Object.assign(controlOptions, {
  router: router
})).addTo(map);

var lrmControlCustom = L.Routing.control(Object.assign(controlOptionsCustom, {
  router: routerCustom
})).addTo(map);

// User selected safetyPreferences
var safetyEnabled = false;
var safetyToggle = document.getElementById('safetyCheckbox')
safetyToggle.onclick = function (e){
  safetyEnabled = e.target.checked;
};

// does the stuff above only happen once?
var toolsControl = tools.control(localization.get(mergedOptions.language), localization.getLanguages(), options.tools).addTo(map);
var state = state(map, lrmControl, lrmControlCustom, toolsControl, mergedOptions, safetyEnabled);

plan.on('waypointgeocoded', function(e) {
  if (plan._waypoints.filter(function(wp) {
    return !!wp.latLng;
  }).length < 2) {
    map.panTo(e.waypoint.latLng);
  }
});

// add onClick event
map.on('click', function (e) {
  // console.log(e.clientX)
  // if (e.clientX >360) {
  addWaypoint(e.latlng);
  // }

});
function addWaypoint(waypoint) {
  if (safetyEnabled) {
    return;
    var length = lrmControlCustom.getWaypoints().filter(function(pnt) {
      return pnt.latLng;
    });
    length = length.length;
    if (!length) {
      lrmControlCustom.spliceWaypoints(0, 1, waypoint);
    } else {
      if (length === 1) length = length + 1;
      lrmControlCustom.spliceWaypoints(length - 1, 1, waypoint);
    }
  }
  else {
    var length = lrmControl.getWaypoints().filter(function(pnt) {
      return pnt.latLng;
    });
    length = length.length;
    if (!length) {
      lrmControl.spliceWaypoints(0, 1, waypoint);
    } else {
      if (length === 1) length = length + 1;
      lrmControl.spliceWaypoints(length - 1, 1, waypoint);
    }
  }
}

// User selected routes
lrmControl.on('alternateChosen', function(e) {
  if (safetyEnabled) return;
  var directions = document.querySelectorAll('.leaflet-routing-alt');
  if (directions[0].style.display != 'none') {
    directions[0].style.display = 'none';
    directions[1].style.display = 'block';
  } else {
    directions[0].style.display = 'block';
    directions[1].style.display = 'none';
  }
});

lrmControlCustom.on('alternateChosen', function(e) {
  return;
  if (!safetyEnabled) return;
  var directions = document.querySelectorAll('.leaflet-routing-alt');
  if (directions[0].style.display != 'none') {
    directions[0].style.display = 'none';
    directions[1].style.display = 'block';
  } else {
    directions[0].style.display = 'block';
    directions[1].style.display = 'none';
  }
});

// Route export
lrmControl.on('routeselected', function(e) {
  if (safetyEnabled) return;
  var route = e.route || {};
  var routeGeoJSON = {
    type: 'Feature',
    properties: {
      name: route.name,
      copyright: {
        author: 'OpenStreetMap contributors',
        license: 'http://www.openstreetmap.org/copyright'
      },
      link: {
        href: window.document.location.href,
        text: window.document.title
      },
      time: (new Date()).toISOString()
    },
    geometry: {
      type: 'LineString',
      coordinates: (route.coordinates || []).map(function (coordinate) {
        return [coordinate.lng, coordinate.lat];
      })
    }
  };
  toolsControl.setRouteGeoJSON(routeGeoJSON);
});

lrmControlCustom.on('routeselected', function(e) {
  return;
  if (!safetyEnabled) return;
  var route = e.route || {};
  var routeGeoJSON = {
    type: 'Feature',
    properties: {
      name: route.name,
      copyright: {
        author: 'OpenStreetMap contributors',
        license: 'http://www.openstreetmap.org/copyright'
      },
      link: {
        href: window.document.location.href,
        text: window.document.title
      },
      time: (new Date()).toISOString()
    },
    geometry: {
      type: 'LineString',
      coordinates: (route.coordinates || []).map(function (coordinate) {
        return [coordinate.lng, coordinate.lat];
      })
    }
  };
  toolsControl.setRouteGeoJSON(routeGeoJSON);
});
plan.on('waypointschanged', function(e) {
  if (!e.waypoints ||
      e.waypoints.filter(function(wp) {
        return !wp.latLng;
      }).length > 0) {
    toolsControl.setRouteGeoJSON(null);
  }
});

L.control.locate({
  follow: false,
  setView: true,
  remainActive: false,
  keepCurrentZoomLevel: true,
  stopFollowingOnDrag: false,
  onLocationError: function(err) {
    alert(err.message)
  },
  onLocationOutsideMapBounds: function(context) {
    alert(context.options.strings.outsideMapBoundsMsg);
  },
  showPopup: false,
  locateOptions: {}
}).addTo(map);

var checkbox = L.control();
checkbox.onAdd = function(map) {
  var div = L.DomUtil.create('div', 'checkbox-container');

  div.innerHTML = '<form name="preferences"> <h4 style="padding-left:8px">Safety Preferences</h4> \
   <fieldset style="border: 0;"> <input type="checkbox" name="safety_factors" value="Lighting">Lighting<br> \
   <input type="checkbox" name="safety_factors" value="Sidewalks">Sidewalks<br> \
   <input type="checkbox" name="safety_factors" value="Road Speed">Road speed<br> \
   <input type="submit" name="save-safety-factors" value="Save" style="color=blue"; /> </fieldset>'

  return div;
};

checkbox.addTo(map);