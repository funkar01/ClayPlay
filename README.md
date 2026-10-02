# ClayPlay

OpenCV based sculpting-modelling project for fun

You are a senior designer and developer expertised in creating fun and cool web experiences. 



ClayPlay is a fun project where the experience is about sculpting and modelling the clay with hands. The only hardware required is the PC with webcam. Just analyse the below action plan and let me know what are your thoughts of building this fun project to engage audience!



Here's a phased plan. Each phase ends with something playable, so you always have a working demo. 



Phase 1: Hand tracking works (day 1)



Set up a Vite + Three.js project.

Add MediaPipe Hand Landmarker and draw the 21 landmarks over the webcam feed.

Smooth the landmark jitter with a simple filter (such as a one-euro filter or a moving average).

Done when: you see a stable skeleton following your hand.



Phase 2: A clay blob you can push (days 2-3)



Create a high-resolution sphere with an icosphere mesh.

Map the index fingertip and thumb positions into your 3D scene.

Detect a pinch (thumb-to-index distance below a threshold), then pull the nearby vertices with a smooth falloff.

Done when: you can pinch and stretch the sphere like dough.



Phase 3: A real sculpting toolkit (week 2)



Add gestures for pinch to pull, open palm to smooth, two fingers to carve, and fist to squash.

Add a brush-size control and an undo stack.

Re-mesh or subdivide where the mesh gets stretched too thin.

Done when: you can sculpt a recognisable mug or animal.



Phase 4: Make it look and feel like clay (week 3)



Add a matte clay material with a fingerprint bump texture, soft lighting, and ambient occlusion.

Add subtle squish sounds and a spinning pottery-wheel mode.

Done when: a screenshot looks good enough to show off.



Phase 5: The AI layer (week 4)



Add text-to-3D starter shapes (Meshy or Tripo) that load in as the clay.

Add optional voice commands such as "make it bigger" or "switch to carve".

Add save and export as GLB, plus a shareable gallery link.

Done when: someone can open a link, say "a sleepy fox," and start sculpting it.



Phase 6: Polish and publish



Record a 30-second demo video, since hand-tracking projects look best in motion.

Add a short write-up covering what you built and what you learned.

Deploy to Vercel or Netlify, then add it to your portfolio.



Habits that will save you time



Keep gesture detection separate from the deformation code. That makes it easy to swap in Quest hand tracking later.

Test with your hands at different distances and in different lighting early. That's where tracking problems usually show up.

Use Claude Code for the boilerplate and the vertex-deformation maths, and spend your own time on how the clay feels. 





