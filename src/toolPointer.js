import * as THREE from 'three';

// Use the same client-space aim for the DOM cursor and every sculpting tool.
export function pointerOnPlane(point, bounds, camera, planeZ = 0) {
  if (!point || !bounds.width || !bounds.height) return null;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(
    (point.x - bounds.left) / bounds.width * 2 - 1,
    1 - (point.y - bounds.top) / bounds.height * 2,
  ), camera);
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ), new THREE.Vector3());
}
