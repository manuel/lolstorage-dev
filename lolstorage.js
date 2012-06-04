/*
  LOLSTORAGE: REALLY SIMPLE DECENTRALIZED SYNDICATION
  ----------------------------------------------------------------------
*/

var lol = (function() {

    var PREFIX = "lol";
    
    function storageKey(key, storeID) {
        return PREFIX + "_" + storeID + "_" + key;
    }

    /*
      LOCAL STORE
      ------------------------------------------------------------------
    */

    /** Creates a new localStorage content store with the given ID.
        IDs allow the use of independent "storage areas" in the
        browser's single localStorage namespace.  The ID should not
        contain special characters. */
    function LocalStore(id) {
        this.id = id;
    }

    LocalStore.prototype.toString = function() {
        return "[Local store " + this.id + "]";
    };

    LocalStore.prototype.get = function(key, cb) {
        var store = this;
        function doit() {
            try {
                var value = window.localStorage.getItem(storageKey(key, store.id));
                console.log("Get " + key +  " from " + store);
                cb(true, (value !== null) ? value : undefined);
            } catch(err) {
                cb(false, err);
            }
        }
        setTimeout(doit, 1);
    };
    
    LocalStore.prototype.put = function(key, value, cb) {
        var store = this;
        function doit() {
            try {
                window.localStorage.setItem(storageKey(key, store.id), value);
                console.log("Put " + key +  " to " + store);
                cb(true);
            } catch(err) {
                cb(false, err);
            }
        }
        setTimeout(doit, 1);
    };

    /*
      REMOTE STORE
      ------------------------------------------------------------------
    */

    function RemoteStore(id, client) {
        this.id = id;
        this.client = client;
    }

    RemoteStore.prototype.toString = function() {
        return "[Remote store " + this.id + "]";
    };

    RemoteStore.prototype.get = function(key, cb) {
        var store = this;
        this.client.get(storageKey(key, store.id), function(error, data) {
            if (error) {
                cb(false, error);
            } else {
                console.log("Get " + key +  " from " + store);
                cb(true, data);
            }
        });
    };
    
    RemoteStore.prototype.put = function(key, value, cb) {
        var store = this;
        this.client.put(storageKey(key, store.id), value, function(error) {
            if (error) {
                cb(false, error);
            } else {
                console.log("Put " + key +  " to " + store);
                cb(true);
            }
        });
    };

    /*
      OBJECTS
      ------------------------------------------------------------------
    */

    var BLOB_TYPE = "blob";
    var TREE_TYPE = "tree";

    function Blob(data) {
        this.lol_type = BLOB_TYPE;
        this.lol_data = data;
    }

    function Tree(entries) {
        this.lol_type = TREE_TYPE;
        this.lol_entries = entries;
    }

    /** Returns the hash of the object - what gets used as the key in
        the content store.  Currently, this uses SHA1, but it can
        later be updated to other hash algorithms by our clever use of
        a prefix. */
    function hash(object) {
        return "sha1-" + Crypto.SHA1(content(object));
    }

    /** Returns the content of the object - what gets stored as the
        value in the content store.  For readability, we're indenting
        the JSON with a tab. */
    function content(object) {
        return JSON.stringify(object, undefined, "\t");
    }

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
        dst.get(srcHash, function(ok, res) {
            if (ok) {
                if (res !== undefined) {
                    // Source object already in destination store.
                    // We're done.
                    cb(true);
                } else {
		    // Source object not in destination store.  Fetch
                    // source object from source store and perform its
                    // type-specific sync logic.
                    src.get(srcHash, function(ok, res) {
                        if (ok) {
                            if (res !== undefined) {
                                var srcObj = parse(res);
                                srcObj.sync(src, srcHash, dst, dstHash, cb);
                            } else {
                                cb(false, "Source object " + srcHash + 
                                   " missing in source store " + src);
                            }
                        } else {
                            cb(false, res);
                        }
                    });
                }
            } else {
                cb(false, res);
            }
        });
    }

    Blob.prototype.sync = function(src, srcHash, dst, dstHash, cb) {
	// Simply update the blob.
        dst.put(hash(this), content(this), cb);
    };

    Tree.prototype.sync = function(src, srcHash, dst, dstHash, cb) {
        var srcObj = this;
        if (dstHash !== null) {
	    // Destination store has a current state. Fetch it.
            dst.get(dstHash, function(ok, res) {
                if (ok) {
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
                        cb(false, "Destination object " + dstHash + 
                           " missing in destination store " + dst);
                    }
                } else {
                    cb(false, res);
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

        // This callback gets called after all child entries have been
        // synced, and stores the tree in the destination store.  This
        // ensures the invariant that a tree only gets stored after
        // all its entries have been stored.
        function treeCB(ok) {
            if (ok) {
                dst.put(hash(srcTree), content(srcTree), cb);
            } else {
                cb(false, "Failed to sync tree " + hash(srcTree));
            }
        }

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
	    // Else: Unchanged entry.  Nothing to do.
        }

	// Construct a multi-callback for combining the many callbacks
	// for each difference from the previous step, and sync each
	// of them.
        if (diffs.length > 0) {
            var multiCB = multiCallback(diffs.length, treeCB);
            for (var i = 0; i < diffs.length; i++) {
                var diff = diffs[i];
                sync(src, diff.srcHash, dst, diff.dstHash, multiCB);
            }
        } else {
	    // No changed entries.  Store tree.
	    // FIXME: A weird case.  Could happen if two trees with
	    // the same entries are hashed differently, e.g. because
	    // of JSON formatting differences.
            treeCB(true);
        }
    }

    /** Returns a callback function that OKs the given callback after
        it has been called count times. */
    function multiCallback(count, cb) {
        if (count <= 0)
            throw("Count must be greater than zero.");
        var called = 0;
        var multiCB = function(ok, res) {
            if (ok) {
                called++;
                if (called === count) {
                    cb(ok);
                }
            } else {
                cb(false, res);
            }
        };
        return multiCB;
    }

    /*
      EXPORTS
      ------------------------------------------------------------------
    */

    return {
        "Blob": Blob,
        "LocalStore": LocalStore,
        "RemoteStore": RemoteStore,
        "Tree": Tree,
        "content": content,
        "hash": hash,
        "parse": parse,
        "sync": sync,
    };

}());
