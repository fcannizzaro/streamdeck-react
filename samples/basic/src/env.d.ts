// CSS module type declarations for Vite ?inline imports
declare module "*.css?inline" {
  const content: string;
  export default content;
}
