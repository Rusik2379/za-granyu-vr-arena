'use strict';
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const selector = '.section-head, .game-card, .price-card, .step, .review, .included, .feature-row, .timeline-item, .quest-display, .yandex-map';
  const watched = new WeakSet();
  let observer;
  const show = element => {
    element.classList.add('is-revealed');
    observer?.unobserve(element);
  };
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) show(entry.target);
    }, {threshold:0.08, rootMargin:'0px 0px -24px 0px'});
  }
  function watch(root) {
    if (!observer || preference.matches || !(root instanceof Element)) return;
    const elements = [...(root.matches(selector)?[root]:[]), ...root.querySelectorAll(selector)];
    elements.forEach((element,index) => {
      if (watched.has(element)) return;
      watched.add(element);
      element.classList.add('motion-reveal');
      element.style.setProperty('--reveal-delay',`${index%3*65}ms`);
      observer.observe(element);
    });
  }
  function animateHero() {
    if (preference.matches) return;
    ['.hero h1','.hero-sub','.hero-actions'].forEach((selector,index) => {
      const element=document.querySelector(selector);
      if (!element?.animate) return;
      element.getAnimations().forEach(animation=>animation.cancel());
      element.animate([{opacity:0,transform:'translateY(16px)'},{opacity:1,transform:'translateY(0)'}],
        {duration:650,delay:index*65,easing:'cubic-bezier(.2,.65,.3,1)',fill:'backwards'});
    });
  }
  const app=document.querySelector('#app');
  if (app) {
    watch(app);
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) watch(node);
    }).observe(app,{childList:true,subtree:true});
  }
  document.addEventListener('focusin',event => {
    const element=event.target.closest('.motion-reveal');
    if (element) show(element);
  });
  document.addEventListener('click',event => {
    if (event.target.closest('[data-action="slide"]')) animateHero();
  });
  preference.addEventListener('change',() => {
    if (preference.matches) {
      document.querySelectorAll('.motion-reveal').forEach(show);
      document.querySelectorAll('.hero h1,.hero-sub,.hero-actions').forEach(element=>element.getAnimations().forEach(animation=>animation.cancel()));
    } else if(app) watch(app);
  });
  animateHero();
})();
