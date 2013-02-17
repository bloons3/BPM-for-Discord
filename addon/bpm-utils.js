/*
 * Log functions. You should use these in preference to console.log(), which
 * isn't always available.
 */
var _log_buffer = [];
_global_this.bpm_logs = _log_buffer; // For console access

var _LOG_DEBUG = 0;
var _LOG_INFO = 1;
var _LOG_WARNING = 2;
var _LOG_ERROR = 3;
var _LOG_LEVEL = DEV_MODE ? _LOG_DEBUG : _LOG_WARNING;

var _console = find_global("console");
var _gm_log = find_global("GM_log");
var _raw_log;

if(_console && _console.log) {
    _raw_log = _console.log.bind(_console);
} else if(_gm_log) {
    _raw_log = function() {
        var args = Array.prototype.slice.call(arguments);
        var msg = args.join(" ");
        _gm_log(msg);
    };
} else {
    // ?!?
    _raw_log = function() {};
}

function _wrap_logger(cname, prefix, level) {
    if(_LOG_LEVEL > level) {
        return (function() {});
    }
    if(_console && _console[cname]) {
        var cfunc = _console[cname].bind(_console);
    } else {
        var cfunc = _raw_log;
    }
    return function() {
        var args = Array.prototype.slice.call(arguments)
        args.unshift(prefix);
        if(window.name) {
            args.unshift("[" + window.name + "]:");
        }
        _log_buffer.push(args.join(" "));
        args.unshift("BPM:");
        cfunc.apply(null, args);
    }
}

var log_debug = _wrap_logger("log", "DEBUG:", _LOG_DEBUG);
var log_info = _wrap_logger("log", "INFO:", _LOG_INFO);
var log_warn = _wrap_logger("warn", "WARNING:", _LOG_WARNING);
var log_error = _wrap_logger("error", "ERROR:", _LOG_ERROR);
var log_trace = function() {};
if(_console && _console.trace) {
    log_trace = _console.trace.bind(_console);
}

/*
 * A string referring to the current platform BPM is running on. This is a
 * best guess, made by inspecting global variables, and needed because this
 * script runs unmodified on all supported platforms.
 */
var platform;
// FIXME: "self" is a standard object, though self.on is specific to
// Firefox content scripts. I'd prefer something a little more clearly
// affiliated, though.
//
// Need to check GM_log first, because stuff like chrome.extension
// exists even in userscript contexts.
if(_gm_log) {
    platform = "userscript";
} else if(self.on) {
    platform = "firefox-ext";
} else if(find_global("chrome") && chrome.extension) {
    platform = "chrome-ext";
} else if(find_global("opera") && opera.extension) {
    platform = "opera-ext";
} else {
    log_error("Unknown platform! Your installation is badly broken.");
    platform = "unknown";
    // may as well just die at this point; nothing will actually work
}

log_debug("Platform:", platform);

/*
 * Injects a sneaky little link at the bottom of each Reddit page that
 * displays the logs.
 */
function inject_reddit_log_button() {
    var reddit_footer = find_class(document.body, "footer-parent");

    // <div><pre>...</pre> <a>[dump bpm logs]</a></div>
    var container = document.createElement("div");
    container.className = "bottommenu";
    var output = document.createElement("pre");
    output.style.display = "none";
    output.style.textAlign = "left";
    output.style.borderStyle = "solid";
    output.style.width = "50%";
    output.style.margin = "auto auto auto auto";
    var link = document.createElement("a");
    link.href = "javascript:void(0)";
    link.textContent = "[dump bpm logs]";
    container.appendChild(link);
    container.appendChild(output);

    link.addEventListener("click", catch_errors(function(event) {
        output.style.display = "block";
        var logs = _log_buffer.join("\n");
        output.textContent = logs;
    }), false);

    reddit_footer.appendChild(container);
}

/*
 * Generates a random string made of [a-z] characters, default 24 chars
 * long.
 */
function random_id(length) {
    if(length === undefined) {
        length = 24;
    }

    var index, tmp = "";
    for(var i = 0; i < length; i++) {
        index = Math.floor(Math.random() * 25);
        tmp += "abcdefghijklmnopqrstuvwxyz"[index];
    }
    return tmp;
}

/*
 * str.endswith()
 */
function ends_with(text, s) {
    return text.slice(-s.length) === s;
}

/*
 * Wraps a function with an error-detecting variant. Useful for callbacks
 * and the like, since some browsers (Firefox...) have a way of swallowing
 * exceptions.
 */
function catch_errors(f) {
    return function() {
        try {
            return f.apply(this, arguments);
        } catch(e) {
            log_error("Exception on line " + e.lineNumber + ": ", e.name + ": " + e.message);
            log_error("Current stack:");
            log_trace(); // Not as useful as we'd like since we're calling it from here
            throw e;
        }
    };
}

/*
 * Wrapper for a one-shot event with callback list and setup function.
 * Returns a "with_X"-like function that accepts callbacks. Example usage:
 *
 * var with_n = event(function(ready) {
 *     ready(256);
 * });
 * with_n(function(n) {
 *     log_debug(n);
 * });
 */
function event(setup) {
    var callbacks = [];
    var result;
    var triggered = false;
    var init = false;

    function listen(callback) {
        if(!init) {
            setup(trigger);
            init = true;
        }

        if(triggered) {
            callback(result);
        } else {
            callbacks.push(callback);
        }
    }

    function trigger(r) {
        result = r;
        triggered = true;
        for(var i = 0; i < callbacks.length; i++) {
            callbacks[i](r);
        }
        callbacks = null;
    }

    listen.trigger = trigger;
    return listen;
}

/*
 * A reference to the MutationObserver object. It's unprefixed on Firefox,
 * but not on Chrome. Safari presumably has this as well. Defined to be
 * null on platforms that don't support it.
 */
// NOTE: As of right now, MutationObserver is badly broken on Chrome.
// https://code.google.com/p/chromium/issues/detail?id=160985
// Disabling it until they release a fix.
var MutationObserver = (find_global("MutationObserver") || /*find_global("WebKitMutationObserver") ||*/ find_global("MozMutationObserver") || null);

/*
 * Wrapper to monitor the DOM for inserted nodes, using either
 * MutationObserver or DOMNodeInserted, falling back for a broken MO object.
 */
function observe_document(callback) {
    if(MutationObserver) {
        log_debug("Monitoring document with MutationObserver");
        var observer = new MutationObserver(catch_errors(function(mutations, observer) {
            for(var m = 0; m < mutations.length; m++) {
                var added = mutations[m].addedNodes;
                if(!added || !added.length) {
                    continue; // Nothing to do
                }

                callback(added);
            }
        }));

        try {
            // FIXME: For some reason observe(document.body, [...]) doesn't work
            // on Firefox. It just throws an exception. document works.
            observer.observe(document, {"childList": true, "subtree": true});
            return;
        } catch(e) {
            // Failed with whatever the error of the week is
            log_warning("Can't use MutationObserver: L" + e.lineNumber + ": ", e.name + ": " + e.message + ")");
        }
    }

    log_debug("Monitoring document with DOMNodeInserted");
    document.body.addEventListener("DOMNodeInserted", catch_errors(function(event) {
        callback([event.target]);
    }));
}

/*
 * Makes a nice <style> element out of the given CSS.
 */
function style_tag(css) {
    log_debug("Building <style> tag");
    var tag = document.createElement("style");
    tag.type = "text/css";
    tag.textContent = css;
    return tag;
}

/*
 * Makes a nice <link> element to the given URL (for CSS).
 */
function stylesheet_link(url) {
    log_debug("Building <link> tag to", url);
    var tag = document.createElement("link");
    tag.href = url;
    tag.rel = "stylesheet";
    tag.type = "text/css";
    return tag;
}

/*
 * Determines whether this element, or any ancestor, have the given id.
 */
function id_above(element, id) {
    while(true) {
        if(element.id === id) {
            return true;
        } else if(element.parentElement) {
            element = element.parentElement;
        } else {
            return false;
        }
    }
}

/*
 * Determines whether this element, or any ancestor, have the given class.
 */
function class_above(element, class_name) {
    while(true) {
        if(element.classList.contains(class_name)) {
            return element;
        } else if(element.parentElement) {
            element = element.parentElement;
        } else {
            return null;
        }
    }
}

/*
 * Helper function to make elements "draggable", i.e. clicking and dragging
 * them will move them around.
 */
function enable_drag(element, start_callback, callback) {
    var start_x, start_y;

    var on_mousemove = catch_errors(function(event) {
        var dx = event.clientX - start_x;
        var dy = event.clientY - start_y;
        callback(event, dx, dy);
    });

    element.addEventListener("mousedown", catch_errors(function(event) {
        start_x = event.clientX;
        start_y = event.clientY;
        window.addEventListener("mousemove", on_mousemove, false);
        document.body.classList.add("bpm-noselect");
        start_callback(event);
    }), false);

    window.addEventListener("mouseup", catch_errors(function(event) {
        window.removeEventListener("mousemove", on_mousemove, false);
        document.body.classList.remove("bpm-noselect");
    }), false);
}

/*
 * Wrapper around enable_drag for the common case of moving elements.
 */
function make_movable(element, container, callback) {
    var start_x, start_y;

    enable_drag(element, function(event) {
        start_x = parseInt(container.style.left, 10);
        start_y = parseInt(container.style.top, 10);
    }, function(event, dx, dy) {
        var left = Math.max(start_x + dx, 0);
        var top = Math.max(start_y + dy, 0);

        function move() {
            container.style.left = left + "px";
            container.style.top = top + "px";
        }

        if(callback) {
            callback(event, left, top, move);
        } else {
            move();
        }
    });
}

/*
 * Runs the given callback when the DOM is ready, i.e. when DOMContentLoaded
 * fires.
 */
var with_dom = event(function(ready) {
    if(document.readyState === "interactive" || document.readyState === "complete") {
        log_debug("Document already loaded");
        ready();
    } else {
        document.addEventListener("DOMContentLoaded", catch_errors(function(event) {
            log_debug("Document loaded");
            ready();
        }), false);
    }
});

/*
 * A fairly reliable indicator as to whether or not BPM is currently
 * running in a frame.
 */
// Firefox is funny about window/.self/.parent/.top, such that comparing
// references is unreliable. frameElement is the only test I've found so
// far that works consistently.
var running_in_frame = (window !== window.top || window.frameElement);

function _msg_delegate_hack(id, message) {
    /*
     * BetterPonymotes hack to enable cross-origin frame communication in
     * broken browsers.
     */
    // Locate iframe, send message, remove class.
    var iframe = document.getElementsByClassName(id)[0];
    if(iframe) {
        iframe.contentWindow.postMessage(message, "*");
        iframe.classList.remove(id);
        // Locate this script tag and remove it.
        var script = document.getElementById(id);
        script.parentNode.removeChild(script);
    }
}

/*
 * Send a message to an iframe via postMessage(), working around any browser
 * shortcomings to do so.
 *
 * "message" must be JSON-compatible.
 *
 * Note that the targetOrigin of the postMessage() call is "*", no matter
 * what. Don't send anything even slightly interesting.
 */
function message_iframe(frame, message) {
    log_debug("Sending", message, "to", frame);
    if(frame.contentWindow) {
        // Right now, only Firefox and Opera let us access this API.
        frame.contentWindow.postMessage(message, "*");
    } else {
        // Chrome and Opera don't permit *any* access to these variables for
        // some stupid reason, despite them being available on the page.
        // Inject a <script> tag that does the dirty work for us.
        var id = "__betterponymotes_esh_" + random_id();
        frame.classList.add(id);
        var script = document.createElement("script");
        script.type = "text/javascript";
        script.id = id;
        document.head.appendChild(script);
        script.textContent = "(" + _msg_delegate_hack.toString() + ")('" + id + "', " + JSON.stringify(message) + ");";
    }
}

var _tag_blacklist = {
    // Meta tags we should never touch
    "HEAD": 1, "TITLE": 1, "BASE": 1, "LINK": 1, "META": 1, "STYLE": 1, "SCRIPT": 1,
    // Things I'm worried about
    "IFRAME": 1, "OBJECT": 1, "CANVAS": 1, "SVG": 1, "MATH": 1, "TEXTAREA": 1
};
/*
 * Walks the DOM tree from the given root, running a callback on each node
 * where its nodeType === node_filter. Pass only three arguments.
 *
 * This is supposed to be much faster than TreeWalker, and also chunks its
 * work into batches of 1000, waiting 50ms in between in order to ensure
 * browser responsiveness no matter the size of the tree.
 */
function walk_dom(root, node_filter, process, end, node, depth) {
    if(!node) {
        if(_tag_blacklist[root.tagName]) {
            return; // A bit odd, but possible
        } else {
            // Treat root as a special case
            if(root.nodeType === node_filter) {
                process(root);
            }
            node = root.firstChild;
            depth = 1;
        }
    }
    var num = 1000;
    // If the node/root was null for whatever reason, we die here
    while(node && num > 0) {
        num--;
        if(!_tag_blacklist[node.tagName]) {
            // Only process valid nodes.
            if(node.nodeType === node_filter) {
                process(node);
            }
            // Descend (but never into blacklisted tags).
            if(node.hasChildNodes()) {
                node = node.firstChild;
                depth++;
                continue;
            }
        }
        while(!node.nextSibling) {
            node = node.parentNode;
            depth--;
            if(!depth) {
                end();
                return; // Done!
            }
        }
        node = node.nextSibling;
    }
    if(num) {
        // Ran out of nodes, or hit null somehow. I'm not sure how either
        // of these can happen, but oh well.
        end();
    } else {
        setTimeout(function() {
            walk_dom(root, node_filter, process, end, node, depth);
        }, 50);
    }
}

/*
 * Locates an element at or above the given one matching a particular test.
 */
function locate_matching_ancestor(element, predicate, none) {
    while(true) {
        if(predicate(element)) {
            return element;
        } else if(element.parentElement) {
            element = element.parentElement;
        } else {
            return none;
        }
    }
}

/*
 * Locates an element with the given class name. Logs a warning message if
 * more than one element matches. Returns null if there wasn't one.
 */
function find_class(root, class_name) {
    var elements = root.getElementsByClassName(class_name);
    if(!elements.length) {
        return null;
    } else if(elements.length === 1) {
        return elements[0];
    } else {
        log_warning("Multiple elements under", root, "with class '" + class_name + "'");
        return elements[0];
    }
}
