document.addEventListener("DOMContentLoaded", () => {
  const uploadInput = document.getElementById("image-upload");
  const previewContainer = document.getElementById("preview-container");
  const convertBtn = document.getElementById("convert-btn");
  const resultContainer = document.getElementById("result-container");

  let uploadedImage = null;
  let renderer, scene, camera, cube, animationId;

  // Reset preview UI and state
  function resetPreview() {
    previewContainer.innerHTML = '<div class="preview-placeholder">No image selected</div>';
    convertBtn.disabled = true;
    convertBtn.setAttribute("aria-disabled", "true");
    resultContainer.innerHTML = "";
    cleanUpThreeJS();
    uploadedImage = null;
  }

  // Clean up THREE.js scene and animation
  function cleanUpThreeJS() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
      renderer = null;
    }
    scene = null;
    camera = null;
    cube = null;
  }

  // Handle image upload
  uploadInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) {
      resetPreview();
      return;
    }
    if (!file.type.startsWith("image/")) {
      alert("Please upload a valid image file.");
      resetPreview();
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      uploadedImage = e.target.result;
      previewContainer.innerHTML = "";
      const img = document.createElement("img");
      img.src = uploadedImage;
      img.alt = "Uploaded image preview";
      previewContainer.appendChild(img);
      convertBtn.disabled = false;
      convertBtn.setAttribute("aria-disabled", "false");
      resultContainer.innerHTML = "";
      cleanUpThreeJS();
    };
    reader.readAsDataURL(file);
  });

  // Create 3D scene and render cube with texture
  function create3DModel(imageSrc) {
    resultContainer.innerHTML = "";

    const width = resultContainer.clientWidth;
    const height = resultContainer.clientHeight;

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    resultContainer.appendChild(renderer.domElement);

    // Scene
    scene = new THREE.Scene();

    // Camera
    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 3;

    // Light
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(2, 2, 2);
    scene.add(light);

    // Geometry
    const geometry = new THREE.BoxGeometry(1.6, 1.6, 0.4);

    // Load texture
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      imageSrc,
      (texture) => {
        const materials = [
          new THREE.MeshBasicMaterial({ color: 0xcccccc }), // right
          new THREE.MeshBasicMaterial({ color: 0xcccccc }), // left
          new THREE.MeshBasicMaterial({ color: 0xcccccc }), // top
          new THREE.MeshBasicMaterial({ color: 0xcccccc }), // bottom
          new THREE.MeshBasicMaterial({ map: texture }),    // front
          new THREE.MeshBasicMaterial({ map: texture })     // back
        ];

        cube = new THREE.Mesh(geometry, materials);
        scene.add(cube);

        // Enable rotation on drag / touch
        let isDragging = false;
        let previousMousePosition = { x: 0, y: 0 };

        const toRadians = (angle) => angle * (Math.PI / 180);

        function onPointerDown(event) {
          isDragging = true;
          previousMousePosition = {
            x: event.clientX || event.touches[0].clientX,
            y: event.clientY || event.touches[0].clientY,
          };
        }
        function onPointerUp() {
          isDragging = false;
        }
        function onPointerMove(event) {
          if (!isDragging) return;

          const clientX = event.clientX || (event.touches && event.touches[0].clientX);
          const clientY = event.clientY || (event.touches && event.touches[0].clientY);

          const deltaMove = {
            x: clientX - previousMousePosition.x,
            y: clientY - previousMousePosition.y,
          };

          const rotationSpeed = 0.005;

          cube.rotation.y += deltaMove.x * rotationSpeed;
          cube.rotation.x += deltaMove.y * rotationSpeed;

          previousMousePosition = {
            x: clientX,
            y: clientY,
          };
        }

        renderer.domElement.addEventListener("mousedown", onPointerDown);
        renderer.domElement.addEventListener("touchstart", onPointerDown);

        window.addEventListener("mouseup", onPointerUp);
        window.addEventListener("touchend", onPointerUp);

        window.addEventListener("mousemove", onPointerMove);
        window.addEventListener("touchmove", onPointerMove);

        // Animation loop
        function animate() {
          animationId = requestAnimationFrame(animate);
          renderer.render(scene, camera);
        }
        animate();
      },
      undefined,
      () => {
        alert("Failed to load texture from the image.");
        resetPreview();
      }
    );
  }

  // Convert button click handler
  convertBtn.addEventListener("click", () => {
    if (!uploadedImage) return;
    convertBtn.disabled = true;
    convertBtn.textContent = "Converting...";
    create3DModel(uploadedImage);
    convertBtn.textContent = "Convert to 3D";
    convertBtn.disabled = false;
  });

  // Initialize
  resetPreview();
});
