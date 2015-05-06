/*! puppet.js version: 0.4.1
 * (c) 2013 Joachim Wester
 * MIT license
 */

(function (global) {
  /**
   * https://github.com/mrdoob/eventdispatcher.js
   * MIT license
   * @author mrdoob / http://mrdoob.com/
   */

  var EventDispatcher = function () {
  };

  EventDispatcher.prototype = {
    constructor: EventDispatcher,
    apply: function (object) {
      object.addEventListener = EventDispatcher.prototype.addEventListener;
      object.hasEventListener = EventDispatcher.prototype.hasEventListener;
      object.removeEventListener = EventDispatcher.prototype.removeEventListener;
      object.dispatchEvent = EventDispatcher.prototype.dispatchEvent;
    },
    addEventListener: function (type, listener) {
      if (this._listeners === undefined) this._listeners = {};
      var listeners = this._listeners;
      if (listeners[type] === undefined) {
        listeners[type] = [];
      }
      if (listeners[type].indexOf(listener) === -1) {
        listeners[type].push(listener);
      }
    },
    hasEventListener: function (type, listener) {
      if (this._listeners === undefined) return false;
      var listeners = this._listeners;
      if (listeners[type] !== undefined && listeners[type].indexOf(listener) !== -1) {
        return true;
      }
      return false;
    },
    removeEventListener: function (type, listener) {
      if (this._listeners === undefined) return;
      var listeners = this._listeners;
      var listenerArray = listeners[type];
      if (listenerArray !== undefined) {
        var index = listenerArray.indexOf(listener);
        if (index !== -1) {
          listenerArray.splice(index, 1);
        }
      }
    },
    dispatchEvent: function (event) {
      if (this._listeners === undefined) return;
      var listeners = this._listeners;
      var listenerArray = listeners[event.type];
      if (listenerArray !== undefined) {
        event.target = this;
        var array = [];
        var length = listenerArray.length;
        for (var i = 0; i < length; i++) {
          array[i] = listenerArray[i];
        }
        for (var i = 0; i < length; i++) {
          array[i].call(this, event);
        }
      }
    }
  };

  function PuppetNetworkChannel(puppet, useWebSocket, onReceive, onSend, onError, onStateChange) {
    // TODO(tomalec): to be removed once we will achieve better separation of concerns
    this.puppet = puppet;
    onReceive && (this.onReceive = onReceive);
    onSend && (this.onSend = onSend);
    onError && (this.onError = onError);
    onStateChange && (this.onStateChange = onStateChange);

    this.referer = null;

    //useWebSocket = useWebSocket || false;
    var that = this;
    Object.defineProperty(this, "useWebSocket", {
      get: function () {
        return useWebSocket;
      },
      set: function (newValue) {
        if(newValue == false) {
          if(that._ws) {
            that._ws.onclose = function() { //overwrites the previous onclose
              that._ws = null;
            };
            that._ws.close();
          }
        }
        return useWebSocket = newValue;
      }
    });

    this.handleResponseCookie();
  }
  // TODO: auto-configure here #38 (tomalec)
  PuppetNetworkChannel.prototype.establish = function(remoteUrl, bootstrap /*, onConnectionReady*/){
    var network = this;
    return this.xhr(
        remoteUrl,
        'application/json', 
        null,  
        function (res) {
          bootstrap( res.responseText );

          if (network.useWebSocket){
            network.webSocketUpgrade();
          }
          return network;
        }
      );

  };
  /**
   * Send any text message by currently established channel
   * @TODO: handle readyState 2-CLOSING & 3-CLOSED (tomalec)
   * @param  {String} msg message to be sent
   * @return {PuppetNetworkChannel}     self
   */
  PuppetNetworkChannel.prototype.send = function(msg){
    var that = this;
    if (this.useWebSocket) {
      if(!this._ws) {
        this.webSocketUpgrade(function(){
          // send message once WS is there
          that._ws.send(msg);
          that.onSend(msg, that._ws.url, "WS");
        });
      } else if (this._ws.readyState === 0) {
        var oldOnOpen = this._ws.onopen;
        this._ws.onopen = function(){
          oldOnOpen();
          // send message once WS is opened
          that._ws.send(msg);
          that.onSend(msg, that._ws.url, "WS");
        };
      }
      else {
        this._ws.send(msg);
        that.onSend(msg, that._ws.url, "WS");
      }
    }
    else {
      var url = this.referer || this.puppet.remoteUrl;
      //"referer" should be used as the url when sending JSON Patches (see https://github.com/PuppetJs/PuppetJs/wiki/Server-communication)
      this.xhr(url, 'application/json-patch+json', msg, function (res, method) {
          that.onReceive(res.responseText, url, method);
        });
    }
    return this;
  };
  /**
   * Callback function that will be called once message from remote comes.
   * @param {String} [JSONPatch_sequences] message with Array of JSONPatches that were send by remote.
   * @return {[type]} [description]
   */
  PuppetNetworkChannel.prototype.onReceive = function(/*String_with_JSONPatch_sequences*/){};
  PuppetNetworkChannel.prototype.onSend = function () { };
  PuppetNetworkChannel.prototype.onStateChange = function () { };
  PuppetNetworkChannel.prototype.upgrade = function(msg){
  };

  /**
   * Send a WebSocket upgrade request to the server.
   * For testing purposes WS upgrade url is hardcoded now in PuppetJS (replace __default/ID with __default/wsupgrade/ID)
   * In future, server should suggest the WebSocket upgrade URL
   * @TODO:(tomalec)[cleanup] hide from public API.
   * @param {Function} [callback] Function to be called once connection gets opened.
   * @returns {WebSocket} created WebSocket
   */
  PuppetNetworkChannel.prototype.webSocketUpgrade = function (callback) {
    var that = this;
    var host = window.location.host;
    var wsPath = this.referer.replace(/__([^\/]*)\//g, "__$1/wsupgrade/");
    var upgradeURL = "ws://" + host + wsPath;

    that._ws = new WebSocket(upgradeURL);
    that._ws.onopen = function (event) {
      that.onStateChange(that._ws.readyState, upgradeURL);
      callback && callback(event);
      //TODO: trigger on-ready event (tomalec)
    };
    that._ws.onmessage = function (event) {
      that.onReceive(event.data, that._ws.url, "WS");
    };
    that._ws.onerror = function (event) {
      that.onStateChange(that._ws.readyState, upgradeURL, event.data);
      throw new Error("WebSocket connection could not be made." + (event.data || "") + "\nCould not connect to: " + upgradeURL);
    };
    that._ws.onclose = function (event) {
      that.onStateChange(that._ws.readyState, upgradeURL, null, event.code, event.reason);
      throw new Error("WebSocket connection closed" + event.code + " " + event.reason);
    };
  };
  PuppetNetworkChannel.prototype.changeState = function (href) {
    var that = this;
    return this.xhr(href, 'application/json-patch+json', null, function (res, method) {
      that.onReceive(res.responseText, href, method);
    });
  };

  // TODO:(tomalec)[cleanup] hide from public API.
  PuppetNetworkChannel.prototype.setReferer = function (referer) {
    if (this.referer && this.referer !== referer) {
      throw new Error("Session lost. Server replied with a different session ID that was already set. \nPossibly a server restart happened while you were working. \nPlease reload the page.\n\nPrevious session ID: " + this.referer + "\nNew session ID: " + referer);
    }
    this.referer = referer;
  };

  // TODO:(tomalec)[cleanup] hide from public API.
  PuppetNetworkChannel.prototype.handleResponseHeader = function (xhr) {
    var location = xhr.getResponseHeader('X-Location') || xhr.getResponseHeader('Location');
    if (location) {
      this.setReferer(location);
    }
  };

  /**
   * PuppetJs does not use cookies because of sessions (you need to take care of it in your application code)
   * Reason PuppetJs handles cookies is different:
   * JavaScript cannot read HTTP "Location" header for the main HTML document, but it can read cookies
   * So if you want to establish session in the main HTML document, send "Location" value as a cookie
   * The cookie will be erased (replaced with empty value) after reading
   */
  PuppetNetworkChannel.prototype.handleResponseCookie = function () {
    var location = cookie.read('Location');
    if (location) { //if cookie exists and is not empty
      this.setReferer(location);
      cookie.erase('Location');
    }
  };

  /**
   * Internal method to perform XMLHttpRequest
   * @param url (Optional) URL to send the request. If empty string, undefined or null given - the request will be sent to window location
   * @param accept (Optional) HTTP accept header
   * @param data (Optional) Data payload
   * @param [callback(response)] callback to be called in context of puppet with response as argument
   * @returns {XMLHttpRequest} performed XHR
   */
  PuppetNetworkChannel.prototype.xhr = function (url, accept, data, callback) {
    //this.handleResponseCookie();
    cookie.erase('Location'); //more invasive cookie erasing because sometimes the cookie was still visible in the requests
    var that = this;
    var req = new XMLHttpRequest();
    var method = "GET";
    req.onload = function () {
      var res = this;
      that.handleResponseCookie();
      that.handleResponseHeader(res);
      if (res.status >= 400 && res.status <= 599) {
        that.onError(JSON.stringify({ statusCode: res.status, statusText: res.statusText, text: res.responseText }), url, method);
        throw new Error('PuppetJs JSON response error. Server responded with error ' + res.status + ' ' + res.statusText + '\n\n' + res.responseText);
      }
      else {
        callback && callback.call(that.puppet, res, method);
      }
    };
    url = url || window.location.href;
    if (data) {
      method = "PATCH";
      req.open(method, url, true);
      req.setRequestHeader('Content-Type', 'application/json-patch+json');
    }
    else {
      req.open(method, url, true);
    }
    if (accept) {
      req.setRequestHeader('Accept', accept);
    }
    if (that.referer) {
      req.setRequestHeader('X-Referer', that.referer);
    }
    that.onSend(data, url, method);
    req.send(data);

    return req;
  };

  /**
   * Non-queuing object that conforms JSON-Patch-Queue API
   * @param {Function} apply function to apply received patch
   */
  function NoQueue(apply){
    this.apply = apply;
  }
  /** just forward message */
  NoQueue.prototype.send = function(msg){
    return msg;
  };
  /** Apply given JSON Patch sequence immediately */
  NoQueue.prototype.receive = function(obj, sequence){
      this.apply(obj, sequence);    
  };

  /**
   * Defines a connection to a remote PATCH server, serves an object that is persistent between browser and server.
   * @param {Object}             [options]                    map of arguments
   * @param {String}             [options.remoteUrl]          PATCH server URL
   * @param {Function}           [options.callback]        Called after initial state object is received from the remote (NOT necessarily after WS connection was established)
   * @param {Object}             [options.obj]                object where the parsed JSON data will be inserted
   * @param {Boolean}            [options.useWebSocket=false] Set to true to enable WebSocket support
   * @param {RegExp}             [options.ignoreAdd=null]     Regular Expression for `add` operations to be ignored (tested against JSON Pointer in JSON Patch)
   * @param {Boolean}            [options.debug=false]        Set to true to enable debugging mode
   * @param {Function}           [options.onRemoteChange]     Helper callback triggered each time a patch is obtained from remote
   * @param {JSONPointer}        [options.localVersionPath]   local version path, set it to enable Versioned JSON Patch communication
   * @param {JSONPointer}        [options.remoteVersionPath]  remote version path, set it (and `localVersionPath`) to enable Versioned JSON Patch communication
   * @param {Boolean}            [options.ot=false]           true to enable OT
   * @param {Boolean}            [options.purity=false]       true to enable purist mode of OT
   * @param {Function}           [options.onPatchReceived]
   * @param {Function}           [options.onPatchSent]
   * @param {HTMLElement | window} [options.listenTo]         HTMLElement or window to listen to clicks
   */
  function Puppet(options) {
    options || (options={});
    this.debug = options.debug != undefined ? options.debug : true;
    this.remoteUrl = options.remoteUrl;
    this.obj = options.obj || {};
    this.observer = null;
    this.onRemoteChange = options.onRemoteChange;
    this.onPatchReceived = options.onPatchReceived || function () { };
    this.onPatchSent = options.onPatchSent || function () { };
    this.onSocketStateChanged = options.onSocketStateChanged || function () { };

    this.network = new PuppetNetworkChannel(
        this, // puppet instance TODO: to be removed, used for error reporting
        options.useWebSocket || false, // useWebSocket
        this.handleRemoteChange.bind(this), //onReceive
        this.onPatchSent.bind(this), //onSend,
        this.handleRemoteError.bind(this), //onError,
        this.onSocketStateChanged.bind(this) //onStateChange
      );
    
    Object.defineProperty(this, "useWebSocket", {
      get: function () {
        return this.network.useWebSocket;
      },
      set: function (newValue) {
        this.network.useWebSocket = newValue;
      }
    });

    // choose queuing engine
    if(options.localVersionPath){
      if(!options.remoteVersionPath){
        //just versioning
        this.queue = new JSONPatchQueueSynchronous(options.localVersionPath, this.validateAndApplySequence.bind(this), options.purity);
      } else {
        // double versioning or OT
        this.queue = options.ot ?
          new JSONPatchOTAgent(JSONPatchOT.transform, [options.localVersionPath, options.remoteVersionPath], this.validateAndApplySequence.bind(this), options.purity) :
          new JSONPatchQueue([options.localVersionPath, options.remoteVersionPath], this.validateAndApplySequence.bind(this), options.purity); // full or noop OT
      }
    } else {
      // no queue - just api
      this.queue = new NoQueue(this.validateAndApplySequence.bind(this));
    }

    this.ignoreCache = [];
    this.ignoreAdd = options.ignoreAdd || null; //undefined, null or regexp (tested against JSON Pointer in JSON Patch)

    //usage:
    //puppet.ignoreAdd = null;  //undefined or null means that all properties added on client will be sent to remote
    //puppet.ignoreAdd = /./; //ignore all the "add" operations
    //puppet.ignoreAdd = /\/\$.+/; //ignore the "add" operations of properties that start with $
    //puppet.ignoreAdd = /\/_.+/; //ignore the "add" operations of properties that start with _

    var onDataReady = options.callback;
    var puppet = this;
    this.network.establish(this.remoteUrl, function bootstrap(responseText){
      var json = JSON.parse(responseText);
      recursiveExtend(puppet.obj, json);

      if (puppet.debug) {
        puppet.remoteObj = responseText; // JSON.parse(JSON.stringify(puppet.obj));
      }

      recursiveMarkObjProperties(puppet, "obj");
      puppet.observe();
      if (onDataReady) {
        onDataReady.call(puppet, puppet.obj);
      }

    });
  }

  function markObjPropertyByPath(obj, path) {
    var keys = path.split('/');
    var len = keys.length;
    if (keys.length > 2) {
      for (var i = 1; i < len - 1; i++) {
        obj = obj[keys[i]];
      }
    }
    recursiveMarkObjProperties(obj, keys[len - 1]);
  }

  function placeMarkers(parent, key) {
    var subject = parent[key];
    if (subject !== null && typeof subject === 'object' && !subject.hasOwnProperty('$parent')) {
      Object.defineProperty(subject, '$parent', {
        enumerable: false,
        get: function () {
          return parent;
        }
      });
    }
  }

  function recursiveMarkObjProperties(parent, key) {
    placeMarkers(parent, key);
    parent = parent[key];
    for (var i in parent) {
      if (parent.hasOwnProperty(i) && typeof parent[i] === 'object') {
        recursiveMarkObjProperties(parent, i);
      }
    }
  }

  function recursiveExtend(par, obj) {
    for (var i in obj) {
      if (obj.hasOwnProperty(i)) {
        if (typeof obj[i] === 'object' && par.hasOwnProperty(i)) {
          recursiveExtend(par[i], obj[i]);
        }
        else {
          par[i] = obj[i];
        }
      }
    }
  }

  Puppet.prototype = Object.create(EventDispatcher.prototype); //inherit EventTarget API from EventDispatcher

  Puppet.prototype.observe = function () {
    this.observer = jsonpatch.observe(this.obj, this.filterChangedCallback.bind(this));
  };

  Puppet.prototype.unobserve = function () {
    if (this.observer) { //there is a bug in JSON-Patch when trying to unobserve something that is already unobserved
      jsonpatch.unobserve(this.obj, this.observer);
      this.observer = null;
    }
  };

  Puppet.prototype.filterChangedCallback = function (patches) {
    this.filterIgnoredPatches(patches);
    // do nothing for empty change
    if(patches.length){
      // TODO: Find out nicer solution, as currently `.activeElement` does not necessarily matches changed node (tomalec)
      if ((document.activeElement.nodeName !== 'INPUT' && document.activeElement.nodeName !== 'TEXTAREA') || document.activeElement.getAttribute('update-on') === 'input') {
        this.handleLocalChange(patches);
        // Clear already processed patch sequence, 
        // as `jsonpatch.generate` may return this object to for example `#clickAndBlurCallback`
        patches.length = 0; 
      }
    }
  };

  function isIgnored(pattern, ignoreCache, path, op) {
    if (op === 'add' && pattern.test(path)) {
      ignoreCache[path] = true;
      return true;
    }
    var arr = path.split('/');
    var joined = '';
    for (var i = 1, ilen = arr.length; i < ilen; i++) {
      joined += '/' + arr[i];
      if (ignoreCache[joined]) {
        return true; //once we decided to ignore something that was added, other operations (replace, remove, ...) are ignored as well
      }
    }
    return false;
  }

  //ignores private member changes
  Puppet.prototype.filterIgnoredPatches = function (patches) {
    if(this.ignoreAdd){
      for (var i = 0, ilen = patches.length; i < ilen; i++) {
        if (isIgnored(this.ignoreAdd, this.ignoreCache, patches[i].path, patches[i].op)) { //if it is ignored, remove patch
          patches.splice(i, 1); //ignore changes to properties that start with PRIVATE_PREFIX
          ilen--;
          i--;
        }
      }
    }
    return patches;
  };

  Puppet.prototype.handleLocalChange = function (patches) {
    var that = this;
    
    if(this.debug) {
      this.validateSequence(this.remoteObj, patches);
    }

    var txt = JSON.stringify( this.queue.send(patches) );
    if (txt.indexOf('__Jasmine_been_here_before__') > -1) {
      throw new Error("PuppetJs did not handle Jasmine test case correctly");
    }
    this.network.send(txt);
    this.unobserve();
    patches.forEach(function (patch) {
      markObjPropertyByPath(that.obj, patch.path);
    });
    this.observe();
  };

  Puppet.prototype.validateAndApplySequence = function (tree, sequence) {
    if (this.debug) {
      try {
        jsonpatch.apply(tree, sequence, true);
      }
      catch (error) {
        error.message = "Incoming patch validation error: " + error.message;
        var ev;
        if (ErrorEvent.prototype.initErrorEvent) {
          var ev = document.createEvent("ErrorEvent");
          ev.initErrorEvent('error', true, true, error.message, "", ""); //IE10+
          Object.defineProperty(ev, 'error', {value: error}); //ev.error is ignored
        }
        else {
          ev = new ErrorEvent("error", {bubbles: true, cancelable: true, error: error}); //this works everywhere except IE
        }
        this.dispatchEvent(ev);
      }
    }
    else {
      jsonpatch.apply(tree, sequence);
    }
  };

  Puppet.prototype.validateSequence = function (tree, sequence) {
    var error = jsonpatch.validate(sequence, tree);
    if (error) {
      error.message = "Outgoing patch validation error: " + error.message;
      var ev;
      if (ErrorEvent.prototype.initErrorEvent) {
        var ev = document.createEvent("ErrorEvent");
        ev.initErrorEvent('error', true, true, error.message, "", ""); //IE10+
        Object.defineProperty(ev, 'error', {value: error}); //ev.error is ignored
      }
      else {
        ev = new ErrorEvent("error", {bubbles: true, cancelable: true, error: error}); //this works everywhere except IE
      }
      this.dispatchEvent(ev);
    }
  };

  Puppet.prototype.handleRemoteError = function (data, url, method) {
      if (this.onPatchReceived) {
          this.onPatchReceived(data, url, method);
      }
  };

  Puppet.prototype.showWarning = function (heading, description) {
    if (this.debug && global.console && console.warn) {
      if (description) {
        heading += " (" + description + ")";
      }
      console.warn("PuppetJs warning: " + heading);
    }
  };

  Puppet.prototype.handleRemoteChange = function (data, url, method) {
    var patches = JSON.parse(data || '[]'); // fault tolerance - empty response string should be treated as empty patch array
    var that = this;

    if (this.onPatchReceived) {
        this.onPatchReceived(data, url, method);
    }

    if (!this.observer) {
      return; //ignore remote change if we are not watching anymore
    }

    this.unobserve();
    this.queue.receive(this.obj, patches);

    patches.forEach(function (patch) {
      if (patch.path === "") {
        var desc = JSON.stringify(patches);
        if (desc.length > 103) {
          desc = desc.substring(0, 100) + "...";
        }
        //TODO Error
        that.showWarning("Server pushed patch that replaces the object root", desc);
      }
      if (patch.op === "add" || patch.op === "replace" || patch.op === "test") {
        markObjPropertyByPath(that.obj, patch.path);
      }
    });
    this.observe();
    if (this.onRemoteChange) {
      this.onRemoteChange(patches);
    }

    if(this.debug) {
      this.remoteObj = JSON.parse(JSON.stringify(this.obj));
    }
  };
  /**
   * Cookie helper
   * @see Puppet.prototype.handleResponseCookie
   * reference: http://www.quirksmode.org/js/cookies.html
   * reference: https://github.com/js-coder/cookie.js/blob/gh-pages/cookie.js
   */
  var cookie = {
    create: function createCookie(name, value, days) {
      var expires = "";
      if (days) {
        var date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toGMTString();
      }
      document.cookie = name + "=" + value + expires + '; path=/';
    },

    readAll: function readCookies() {
      if (document.cookie === '') return {};
      var cookies = document.cookie.split('; ')
        , result = {};
      for (var i = 0, l = cookies.length; i < l; i++) {
        var item = cookies[i].split('=');
        result[decodeURIComponent(item[0])] = decodeURIComponent(item[1]);
      }
      return result;
    },

    read: function readCookie(name) {
      return cookie.readAll()[name];
    },

    erase: function eraseCookie(name) {
      cookie.create(name, "", -1);
    }
  };

  global.Puppet = Puppet;
})(window);
