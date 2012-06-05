/*
  LOLSTORAGE: DECENTRALIZED CONTENT-ADDRESSED TREE SYNCHRONIZATION
  ----------------------------------------------------------------------
*/

var lol = (function() {

    /** The lowlevel name under which an object identified by a key
        gets stored.  The store ID allows multiple independent storage
        areas in the same underlying storage. */
    function storageKey(key, storeID) {
        return "lol-" + storeID + "-" + key;
    }

    /*
      STORES
      ------------------------------------------------------------------

      A store maps string keys to string values.

      A store has two methods:

      - get(key, callback) retrieves a value from the store.  It calls
        the callback with two arguments, error and result.  If no
        error occurred, error is null and the result is the string
        value (or undefined if the key has no value).  If an error
        occurred, error is an error object and the result is
        undefined.

      - put(key, value, callback) stores a value associated with a key
        in the store.  It calls the callback with one argument, error.
        If no error occurred, error is null.  If an error occurred,
        error is an error object.
    */

    /*
      LOCAL STORE
      ------------------------------------------------------------------
    */

    /** Creates a new localStorage store with the given store ID.  IDs
        allow the use of independent storage areas in the browser's
        single localStorage namespace.  The ID should not contain
        special characters.

        Because localStorage is synchronous, and we don't want to mess
        things up by synchronously calling callbacks that expect to be
        called asynchronously, we use asynchronously() to defer
        callback execution. */
    function LocalStore(id) {
        this.id = id;
    }

    LocalStore.prototype.toString = function() {
        return "[Local store " + this.id + "]";
    };

    LocalStore.prototype.get = function(key, cb) {
        var store = this;
        asynchronously(function () {
            try {
                var value = window.localStorage.getItem(storageKey(key, store.id));
            } catch(err) {
                cb(err);
                return;
            }
            cb(null, (value !== null) ? value : undefined);
        });
    };
    
    LocalStore.prototype.put = function(key, value, cb) {
        var store = this;
        asynchronously(function () {
            try {
                window.localStorage.setItem(storageKey(key, store.id), value);
            } catch(err) {
                cb(err);
                return;
            }
            cb(null);
        });
    };

    /*
      REMOTE STORE
      ------------------------------------------------------------------
    */

    /** Creates a remoteStorage store using the given store ID (see
        above) and remoteStorage API client. */
    function RemoteStore(id, client) {
        this.id = id;
        this.client = client;
    }

    RemoteStore.prototype.toString = function() {
        return "[Remote store " + this.id + "]";
    };

    RemoteStore.prototype.get = function(key, cb) {
        this.client.get(storageKey(key, store.id), cb);
    };
    
    RemoteStore.prototype.put = function(key, value, cb) {
        this.client.put(storageKey(key, store.id), value, cb);
    };

    /*
      CONSOLE LOGGING STORE
      ------------------------------------------------------------------

      Wraps an underlying store, and prints logging messages to console.
    */

    function LoggingStore(wrapped) {
        this.wrapped = wrapped;
    }

    LoggingStore.prototype.get = function(key, cb) {
        console.log("Get " + key + " from " + this.wrapped);
        this.wrapped.get(key, cb);
    }

    LoggingStore.prototype.put = function(key, value, cb) {
        console.log("Put " + key + " to " + this.wrapped);
        this.wrapped.put(key, value, cb);
    }

    LoggingStore.prototype.toString = function() {
        return this.wrapped.toString();
    }

    /*
      OBJECTS
      ------------------------------------------------------------------
    */

    var BLOB_TYPE = "blob";
    var TREE_TYPE = "tree";

    /** Creates a new blob with the given data, which is an arbitrary
        JSON value. */
    function Blob(data) {
        this.lol_type = BLOB_TYPE;
        this.lol_data = data;
    }

    /** Creates a new tree with the given entries, which is a
        dictionary mapping file names to hashes. */
    function Tree(entries) {
        this.lol_type = TREE_TYPE;
        this.lol_entries = entries;
    }

    /** Returns the hash of the object - what gets used as the key in
        the content store.  Currently, this uses SHA1, but it can
        later be updated to other hash algorithms. */
    function hash(object) {
        return "sha1_" + Crypto.SHA1(content(object));
    }

    /** Returns the content of the object - what gets stored as the
        value in the content store.  For readability, we're indenting
        the JSON with a tab. */
    function content(object) {
        return JSON.stringify(object, undefined, "\t");
    }

    /** Parses an object from a JSON-formatted text, and sets up its
        prototype. */
    function parse(text) {
        return JSON.parse(text, function(key, value) {
            if (key === "lol_type") {
                this.__proto__ = objectPrototype(value);
            }
            return value;
        });
    }

    function objectPrototype(typeString) {
        switch(typeString) {
        case BLOB_TYPE: return Blob.prototype;
        case TREE_TYPE: return Tree.prototype;
        default: throw("Unknown type string: " + typeString);
        }
    }

    Blob.prototype.toString = content;
    Tree.prototype.toString = content;
    
    /*
      SYNCHRONIZATION
      ------------------------------------------------------------------
    */

    /** Transfers an object (typically a tree) identified by srcHash
        from the source store (src) to the destination store (dst)
        whose current state is dstHash (or null if destination is
        empty/uninitialized).

	The main invariant exploited by this code is that if a tree
        exists in a store, all its entries are assumed to exist in the
        store, too. */
    function sync(src, srcHash, dst, dstHash, cb) {
        dst.get(srcHash, function(err, res) {
            if (!err) {
                if (res !== undefined) {
                    // Source object already in destination store.
                    // We're done.
                    cb(null);
                } else {
		    // Source object not in destination store.  Fetch
                    // source object from source store and perform its
                    // type-specific sync logic.
                    src.get(srcHash, function(err, res) {
                        if (!err) {
                            if (res !== undefined) {
                                var srcObj = parse(res);
                                srcObj.sync(src, srcHash, dst, dstHash, cb);
                            } else {
                                cb("Source object " + srcHash + 
                                   " missing in source store " + src);
                            }
                        } else {
                            cb(err);
                        }
                    });
                }
            } else {
                cb(err);
            }
        });
    }

    Blob.prototype.sync = function(src, srcHash, dst, dstHash, cb) {
	// Simply store the blob in the destination store.
        //
        // FYI: If the protocol supported PATCH (which it doesn't),
	// this could diff against the destination object and transfer
	// only the diff.
        dst.put(hash(this), content(this), cb);
    };

    Tree.prototype.sync = function(src, srcHash, dst, dstHash, cb) {
        var srcObj = this;
        if (dstHash !== null) {
	    // Destination store has a current state. Fetch it.
            dst.get(dstHash, function(err, res) {
                if (!err) {
                    if (res !== undefined) {
                        var dstObj = parse(res);
                        if (dstObj.lol_type === TREE_TYPE) {
			    // Destination's current state is a tree, too.
			    // Diff against it.
                            treeSync(src, srcObj, dst, dstObj, cb);
                        } else {
			    // Destination's current state is not a
			    // tree.  Diff against null.
                            treeSync(src, srcObj, dst, null, cb);
                        }
                    } else {
                        cb("Destination object" + dstHash + 
                           " missing in destination store " + dst);
                    }
                } else {
                    cb(err);
                }
            });
        } else {
	    // Destination store has no current state.  Diff against null.
            treeSync(src, srcObj, dst, null, cb);
        }
    };

    /** Sync a source tree against a destination tree (or null for the
	empty tree).  Exploit inertia: if two entries (especially
	sub-trees) that have changed have the same file name in the
	source and destination trees, they're probably similar. */
    function treeSync(src, srcTree, dst, dstTree, cb) {

        // Compute a list of differences between source and
	// destination tree.
        var srcEntries = srcTree.lol_entries;
        var dstEntries = (dstTree !== null) ? dstTree.lol_entries : {};
        var diffs = [];
        for (var name in srcEntries) {
            var srcHash = srcEntries[name];
            var dstHash = dstEntries[name];
            if (dstHash === undefined) {
		// Entry in source tree but not in destination tree.
		// Diff entry in source tree against null.
                diffs.push({ srcHash: srcHash, dstHash: null });
            } else if (dstHash !== srcHash) {
		// Entry in source tree and destination tree but with
		// different hashes.  Diff entry in source tree
		// against entry in destination tree.
                diffs.push({ srcHash: srcHash, dstHash: dstHash });
            }
	    // Else: Entry in source and destination trees with same
	    // hash.  Nothing to do.
        }

        // For each changed entry in the tree, sync it.  When all are
        // done, call the final callback.
        var count = diffs.length;
        if (count > 0) {
            var done = 0;
            for (var i = 0; i < count; i++) {
                var diff = diffs[i];
                sync(src, diff.srcHash, dst, diff.dstHash, function(err) {
                    if (!err) {
                        done++;
                        if (done === count) {
                            finalCB(null);
                        }
                    } else {
                        finalCB(err);
                    }
                });
            }
        } else {
            asynchronously(function() { finalCB(null); });
        }

        // This callback gets called after all child entries have been
        // synced, and stores the tree in the destination store.  This
        // ensures the invariant that a tree only gets stored after
        // all its entries have been stored.
        function finalCB(err) {
            if (!err) {
                dst.put(hash(srcTree), content(srcTree), cb);
            } else {
                cb("Failed to sync tree " + hash(srcTree));
            }
        }

    }

    /** Calls a function asynchronously, i.e. not on the stack.  Note
        that the function's "this" will be the global object or
        similar. */
    function asynchronously(fun) {
        setTimeout(fun, 1);
    }

    /*
      INTEGRITY CHECKING
      ------------------------------------------------------------------
    */

    /** Checks whether all items under a root hash exist in the store,
        and their hashes are correct. */
    function fsck(store, hash, cb) {
        store.get(hash, function(err, res) {
            if (!err) {
                if (res !== undefined) {
                    var obj = parse(res);
                    obj.fsck(store, hash, cb);
                } else {
                    cb("Object " + hash + " missing in " + store);
                }
            } else {
                cb(err);
            }
        });
    }

    Blob.prototype.fsck = function(store, h, cb) {
        if (h !== hash(this)) {
            cb("Incorrect hash " + h + " in store " + store);
        } else {
            cb(null);
        }
    }

    Tree.prototype.fsck = function(store, h, cb) {
        if (h !== hash(this)) {
            cb("Incorrect hash " + h + " in store " + store);
        } else {
            var count = Object.keys(this.lol_entries).length;
            if (count > 0) {
                var done = 0;
                for (var name in this.lol_entries) {
                    fsck(store, this.lol_entries[name], function(err) {
                        if (!err) {
                            done++;
                            if (done === count) {
                                cb(null);
                            }
                        } else {
                            cb(err);
                        }
                    });
                }
            } else {
                cb(null);
            }
        }     
    }

    /*
      EXPORTS
      ------------------------------------------------------------------
    */

    return {
        "Blob": Blob,
        "LocalStore": LocalStore,
        "LoggingStore": LoggingStore,
        "RemoteStore": RemoteStore,
        "Tree": Tree,
        "content": content,
        "fsck": fsck,
        "hash": hash,
        "parse": parse,
        "sync": sync,
    };

}());
