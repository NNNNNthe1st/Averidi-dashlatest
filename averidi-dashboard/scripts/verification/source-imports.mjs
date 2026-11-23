import ts from 'typescript';
/** Parse executable imports; quoted repair templates are data, not dependencies. */
export function sourceImports(source,fileName='source.ts'){
 const file=ts.createSourceFile(fileName,source,ts.ScriptTarget.Latest,true, fileName.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const imports=[];
 const literal=node=>ts.isStringLiteralLike(node)?node.text:null;
 function visit(node){
  if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){const value=node.moduleSpecifier&&literal(node.moduleSpecifier);if(value!==null&&value!==undefined)imports.push(value);}
  else if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference)){const value=node.moduleReference.expression&&literal(node.moduleReference.expression);if(value!==null&&value!==undefined)imports.push(value);}
  else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')){const value=node.arguments[0]&&literal(node.arguments[0]);if(value!==null&&value!==undefined)imports.push(value);}
  ts.forEachChild(node,visit);
 }
 visit(file);return imports;
}
