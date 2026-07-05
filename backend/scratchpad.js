const Y = require('yjs');
const doc = new Y.Doc();
const ytext = doc.getText('monaco');
ytext.insert(0, 'LineOne');
ytext.insert(7, '\nLineTwo');
let curr = ytext._start;
while (curr) {
  console.log(curr.id.clock, curr.content.getContent().join(''), curr.length);
  curr = curr.right;
}
