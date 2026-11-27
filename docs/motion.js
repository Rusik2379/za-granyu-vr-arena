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
    ['.hero h1','.hero-sub'].forEach((selector,index) => {
      const element=document.querySelector(selector);
      if (!element?.animate) return;
      element.getAnimations().forEach(animation=>animation.cancel());
      element.animate([{opacity:0},{opacity:1}],
        {duration:350,delay:0,easing:'ease-out',fill:'backwards'});
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
  document.addEventListener('zg:hero-slide',animateHero);
  preference.addEventListener('change',() => {
    if (preference.matches) {
      document.querySelectorAll('.motion-reveal').forEach(show);
      document.querySelectorAll('.hero h1,.hero-sub,.hero-actions').forEach(element=>element.getAnimations().forEach(animation=>animation.cancel()));
    } else if(app) watch(app);
  });
  // Render the first headline immediately; animate only intentional slide changes.
})();

// Keep the promo launcher away from the site's own booking form on every screen.
(() => {
  if (!('IntersectionObserver' in window)) return;
  let section;
  const observer = new IntersectionObserver(entries => {
    document.body.classList.toggle('booking-section-active', entries.some(entry => entry.isIntersecting));
  }, {rootMargin: '-100px 0px -100px 0px'});
  function watchBookingSection() {
    const next = document.getElementById('booking');
    if (next === section) return;
    observer.disconnect();
    document.body.classList.remove('booking-section-active');
    section = next;
    if (section) observer.observe(section);
  }
  watchBookingSection();
  const app = document.getElementById('app');
  if (app) new MutationObserver(watchBookingSection).observe(app, {childList: true});
})();

// Keep native details/summary semantics and animate both directions, including reversals.
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Map();
  function finish(details, state) {
    if (active.get(details) !== state) return;
    state.animation.onfinish = null;
    state.animation.oncancel = null;
    state.animation.cancel();
    details.open = state.opening;
    details.style.removeProperty('height');
    details.style.removeProperty('overflow');
    active.delete(details);
  }
  document.addEventListener('click', event => {
    const summary = event.target instanceof Element ? event.target.closest('.faq-list summary') : null;
    if (!summary || event.defaultPrevented || event.button !== 0 || preference.matches) return;
    const details = summary.parentElement;
    if (typeof details.animate !== 'function') return;
    event.preventDefault();
    const previous = active.get(details);
    const opening = previous ? !previous.opening : !details.open;
    const start = details.getBoundingClientRect().height;
    if (previous) {
      previous.animation.onfinish = null;
      previous.animation.oncancel = null;
      previous.animation.cancel();
    }
    details.open = true;
    details.style.height = 'auto';
    const style = getComputedStyle(details);
    const frame = ['borderTopWidth','borderBottomWidth','paddingTop','paddingBottom']
      .reduce((sum, key) => sum + (parseFloat(style[key]) || 0), 0);
    const end = opening ? details.getBoundingClientRect().height : summary.getBoundingClientRect().height + frame;
    details.style.overflow = 'hidden';
    details.style.height = end + 'px';
    const animation = details.animate([{height:start+'px'}, {height:end+'px'}],
      {duration:280, easing:'cubic-bezier(.22,.61,.36,1)', fill:'both'});
    const state = {animation, opening};
    active.set(details, state);
    animation.onfinish = () => finish(details, state);
    animation.oncancel = () => finish(details, state);
  });
  preference.addEventListener('change', () => {
    if (preference.matches) for (const [details, state] of active) finish(details, state);
  });
})();
