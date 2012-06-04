function consoleCB(ok, res) {
    if (ok) {
        console.log("OK");
        if (res !== undefined)
            console.log(res);
    } else {
        console.error("Error: " + res);
    }
}

var s1 = new lol.LocalStore("s1");
var s2 = new lol.LocalStore("s2");

var file1 = new lol.Blob("Hello world!");
var file2 = new lol.Blob("Cruel2");

var subTree = new lol.Tree({ "hello-world.txt": lol.hash(file1),
                             "cruelty.txt": lol.hash(file2) });
var tree = new lol.Tree({ "sub-tree": lol.hash(subTree) });

s1.put(lol.hash(file1), lol.content(file1), consoleCB);
s1.put(lol.hash(file2), lol.content(file2), consoleCB);
s1.put(lol.hash(subTree), lol.content(subTree), consoleCB);
s1.put(lol.hash(tree), lol.content(tree), consoleCB);

lol.sync(s1, lol.hash(tree), s2, null, consoleCB);
