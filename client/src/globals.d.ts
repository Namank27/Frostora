declare module "*.css";
declare module "*.webp" {
  const src: string;
  export default src;
}
declare module "*.txt" {
  const content: string;
  export default content;
}
