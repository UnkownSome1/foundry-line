// Procedural image-based lighting: renders a tiny "sky + light panels" scene into a
// PMREM so metals (slide, barrel, containers) get believable reflections.
import * as THREE from 'three';

export function buildEnvironment(renderer, { sky = 0x9fb8d6, horizon = 0xdcc7a8, ground = 0x4a4238, sun = 0xfff0d0, sunDir = new THREE.Vector3(-0.6, 0.45, 0.35) } = {}) {
  const envScene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top: { value: new THREE.Color(sky) },
      mid: { value: new THREE.Color(horizon) },
      bot: { value: new THREE.Color(ground) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.6)) : mix(mid, bot, pow(-h, 0.4));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  envScene.add(new THREE.Mesh(geo, mat));
  // bright sun disc + soft studio panels for crisp highlights on small parts
  const panel = (w, h, color, intensity, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  };
  panel(2.2, 2.2, sun, 12, sunDir.clone().normalize().multiplyScalar(8));
  panel(6, 1.2, 0xffffff, 2.2, new THREE.Vector3(0, 7, -4));
  panel(4, 1.5, 0xcfe0ff, 1.6, new THREE.Vector3(6, 3, 5));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  geo.dispose();
  return rt.texture;
}
