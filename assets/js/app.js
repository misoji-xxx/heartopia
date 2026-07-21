(() => {
  "use strict";

  const ADVANCED_EVENT_CATEGORIES = [
    { value: "advanced", label: "上級" },
    { value: "event", label: "イベント" }
  ];
  const STANDARD_CATEGORIES = [
    { value: "normal", label: "通常" },
    ...ADVANCED_EVENT_CATEGORIES
  ];

  const COLLECTIONS = {
    bird: {
      key: "bird",
      label: "野鳥",
      dataPath: "data/bird.json",
      icon: "mgc_bird_fill",
      categories: STANDARD_CATEGORIES
    },
    fish: {
      key: "fish",
      label: "魚",
      dataPath: "data/fish.json",
      icon: "mgc_fish_fill",
      categories: [
        { value: "river", label: "川" },
        { value: "lake", label: "湖" },
        { value: "sea", label: "海" },
        ...ADVANCED_EVENT_CATEGORIES
      ]
    },
    insect: {
      key: "insect",
      label: "昆虫",
      dataPath: "data/insect.json",
      icon: "mgc_butterfly_fill",
      categories: STANDARD_CATEGORIES
    },
    gourmet: {
      key: "gourmet",
      label: "グルメ",
      dataPath: "data/gourmet.json",
      icon: "mgc_soup_pot_2_fill",
      categories: STANDARD_CATEGORIES
    }
  };
  const WEATHER_ICONS = {
    "晴れ": "mgc_sun_fill",
    "雨": "mgc_rain_fill",
    "虹": "mgc_rainbow_fill",
    "雪": "mgc_snow_fill"
  };
  const RECIPE_SLOT_LIMIT = 4;
  const INGREDIENT_PLACEHOLDER_PATH = "assets/images/ingredients/_placeholder.svg";

  const pageKey = document.body.dataset.page;

  if (pageKey === "home") {
    initializeHome();
    return;
  }

  const config = COLLECTIONS[pageKey];
  const root = document.querySelector("[data-collection-root]");

  if (config && root) {
    initializeCollection(config, root);
  }

  function initializeHome() {
    const totalElement = document.querySelector("#homeTotalCount");
    const requests = Object.values(COLLECTIONS).map(async (collection) => {
      const response = await fetch(collection.dataPath);
      if (!response.ok) {
        throw new Error(`${collection.dataPath} の読込に失敗しました。`);
      }

      const items = await response.json();
      const countElement = document.querySelector(`[data-home-count="${collection.key}"]`);
      if (countElement) {
        countElement.textContent = `${items.length.toLocaleString("ja-JP")}件`;
      }
      return items.length;
    });

    Promise.all(requests)
      .then((counts) => {
        if (totalElement) {
          const total = counts.reduce((sum, count) => sum + count, 0);
          totalElement.textContent = total.toLocaleString("ja-JP");
        }
      })
      .catch(() => {
        // HTML内の件数をフォールバックとして維持します。
      });
  }

  async function initializeCollection(collection, collectionRoot) {
    const content = collectionRoot.querySelector("[data-collection-content]");
    const state = {
      query: "",
      category: "",
      weather: "",
      location: "",
      hideRatedOneToFour: false,
      hideRatedFive: false,
      sort: "original"
    };
    let items = [];

    content.innerHTML = renderLoadingState(collection.label);

    try {
      const response = await fetch(collection.dataPath);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("データ形式が正しくありません。");
      }

      items = data.map((item, index) => prepareItem(collection, item, index));
      content.innerHTML = renderCollectionInterface(collection);

      const controls = getControls(content);
      populateFilterOptions(collection, items, controls);
      bindControls(collection, content, items, state, controls);
      bindRatingActions(collection, content, items, state, controls);
      renderResults(collection, items, state, controls);
      updateProgress(collection, collectionRoot, items);
    } catch (error) {
      content.innerHTML = renderErrorState(collection.label);
      const retryButton = content.querySelector("[data-retry]");
      retryButton?.addEventListener("click", () => window.location.reload());
      console.error(`${collection.label}データの読込に失敗しました。`, error);
    }
  }

  function prepareItem(collection, item, index) {
    if (
      !item
      || typeof item !== "object"
      || typeof item.nameEn !== "string"
      || item.nameEn.length === 0
      || typeof item.nameJa !== "string"
      || item.nameJa.length === 0
      || !Number.isFinite(item.level)
    ) {
      throw new Error(`${collection.label}の${index + 1}件目に必須情報がありません。`);
    }

    const prepared = {
      ...item,
      events: toStringList(item.events),
      prices: Array.isArray(item.prices)
        ? item.prices.filter((price) => (
          price
          && typeof price.currency === "string"
          && Number.isFinite(price.amount)
        ))
        : [],
      _index: index
    };

    if (collection.key === "gourmet") {
      prepared.ingredients = Array.isArray(item.ingredients)
        ? item.ingredients
          .filter((ingredient) => ingredient && typeof ingredient.name === "string" && ingredient.name.length > 0)
          .map((ingredient) => ({
            ...ingredient,
            alternatives: toStringList(ingredient.alternatives),
            quantity: Number.isFinite(ingredient.quantity) ? ingredient.quantity : null
          }))
        : [];
      prepared.energy = Number.isFinite(item.energy)
        ? item.energy
        : null;
    } else {
      prepared.locations = toStringList(item.locations);
      prepared.weathers = toStringList(item.weathers);
      prepared.times = toStringList(item.times);
    }

    if (collection.key === "bird") {
      prepared.fiveStarWeathers = toStringList(item.fiveStarWeathers);
      prepared.fiveStarTimes = toStringList(item.fiveStarTimes);
      prepared.fiveStarAction = typeof item.fiveStarAction === "string" ? item.fiveStarAction : "";
      prepared.distanceMeters = Number.isFinite(item.distanceMeters) ? item.distanceMeters : null;
    } else if (collection.key === "fish") {
      prepared.waterType = typeof item.waterType === "string" ? item.waterType : "";
      prepared.shadow = typeof item.shadow === "string" ? item.shadow : "";
    } else if (collection.key === "insect") {
      prepared.spawnSurfaces = toStringList(item.spawnSurfaces);
    }

    prepared._searchText = createSearchText(collection, prepared);
    return prepared;
  }

  function toStringList(value) {
    return Array.isArray(value)
      ? value.filter((entry) => typeof entry === "string" && entry.length > 0)
      : [];
  }

  function renderCollectionInterface(collection) {
    const categoryChoices = collection.categories
      .map((category) => `<option value="${category.value}">${category.label}</option>`)
      .join("");
    const conditionFilters = collection.key === "gourmet"
      ? ""
      : `
        <label class="index-control">
          <span class="index-control__label">天気</span>
          <select data-filter-weather><option value="">すべての天気</option></select>
        </label>
        <label class="index-control">
          <span class="index-control__label">出現場所</span>
          <select data-filter-location><option value="">すべての場所</option></select>
        </label>`;
    const priceSortOption = collection.key === "gourmet"
      ? '<option value="price">星1売値が高い順</option>'
      : "";
    return `
      <section class="index-tools">
        <div class="index-tools__main">
          <label class="index-search">
            <span class="index-search__label">キーワード検索</span>
            <span class="index-search__field">
              <i class="mgc_search_fill"></i>
              <input type="search" data-filter-search placeholder="${collection.key === "gourmet" ? "名前・材料・イベント名を検索" : "名前・出現条件・売値などを検索"}" autocomplete="off">
              <button class="index-search__clear" type="button" data-search-clear title="検索語を消去" hidden><i class="mgc_close_fill"></i></button>
            </span>
          </label>
          <label class="index-control">
            <span class="index-control__label">分類</span>
            <select data-filter-category>
              <option value="">すべての分類</option>
              ${categoryChoices}
            </select>
          </label>
          ${conditionFilters}
          <label class="index-control">
            <span class="index-control__label">並び順</span>
            <select data-sort>
              <option value="original">掲載順</option>
              <option value="level">解放レベル順</option>
              <option value="name">名前順</option>
              ${priceSortOption}
              <option value="incomplete">星5未達成項目を優先</option>
            </select>
          </label>
        </div>
        <div class="index-switches">
            <label class="index-switch">
              <input type="checkbox" data-hide-one-four>
              星1〜4評価済みを非表示
            </label>
            <label class="index-switch">
              <input type="checkbox" data-hide-five>
              星5評価済みを非表示
            </label>
          <button class="index-reset" type="button" data-reset-filters><i class="mgc_refresh_2_fill"></i>条件を初期化</button>
        </div>
      </section>
      <div class="index-summary">
        <p><strong data-visible-count>0</strong> / <span data-total-count>0</span>件を表示</p>
      </div>
      <div class="collection-index collection-index--${collection.key}" data-results-table>
        <div class="collection-index__head">
          <span class="collection-index__collectible">収集物</span>
          ${collection.key === "gourmet"
            ? "<span>材料</span>"
            : `<span>場所</span>
              <span>天気</span>
              <span>時間</span>
              <span>${collection.key === "bird" ? "撮影距離・星5条件" : collection.key === "fish" ? "魚影サイズ" : "出現条件"}</span>`}
          <span>売値</span>
          ${collection.key === "gourmet" ? "<span>エネルギー</span>" : ""}
          <span>評価</span>
        </div>
        <div class="collection-card-list" data-entry-grid></div>
      </div>
      <div class="empty-state" data-empty-state hidden>
        <div class="state-content">
          <span class="state-icon"><i class="mgc_search_none_fill"></i></span>
          <h2>条件に一致する項目がありません</h2>
          <p>検索語または絞り込み条件を変更してください。</p>
          <button type="button" data-empty-reset><i class="mgc_refresh_2_fill"></i>条件を初期化</button>
        </div>
      </div>`;
  }

  function getControls(content) {
    return {
      search: content.querySelector("[data-filter-search]"),
      searchClear: content.querySelector("[data-search-clear]"),
      category: content.querySelector("[data-filter-category]"),
      weather: content.querySelector("[data-filter-weather]"),
      location: content.querySelector("[data-filter-location]"),
      hideOneFour: content.querySelector("[data-hide-one-four]"),
      hideFive: content.querySelector("[data-hide-five]"),
      sort: content.querySelector("[data-sort]"),
      reset: content.querySelector("[data-reset-filters]"),
      emptyReset: content.querySelector("[data-empty-reset]"),
      visibleCount: content.querySelector("[data-visible-count]"),
      totalCount: content.querySelector("[data-total-count]"),
      table: content.querySelector("[data-results-table]"),
      grid: content.querySelector("[data-entry-grid]"),
      empty: content.querySelector("[data-empty-state]")
    };
  }

  function populateFilterOptions(collection, items, controls) {
    if (collection.key === "gourmet") {
      return;
    }

    const weatherOrder = ["全天気", "晴れ", "雨", "虹", "雪"];
    const weathers = uniqueValues(items.flatMap((item) => item.weathers || []))
      .sort((a, b) => {
        const aIndex = weatherOrder.indexOf(a);
        const bIndex = weatherOrder.indexOf(b);
        if (aIndex === -1 && bIndex === -1) return a.localeCompare(b, "ja");
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
    const locations = uniqueValues(items.flatMap((item) => item.locations || []))
      .sort((a, b) => a.localeCompare(b, "ja"));

    controls.weather.insertAdjacentHTML("beforeend", renderOptions(weathers));
    controls.location.insertAdjacentHTML("beforeend", renderOptions(locations));
  }

  function renderOptions(values) {
    return values.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("");
  }

  function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function bindControls(collection, content, items, state, controls) {
    const refresh = () => renderResults(collection, items, state, controls);
    let searchTimer = null;

    controls.search.addEventListener("input", () => {
      state.query = controls.search.value;
      controls.searchClear.hidden = !state.query;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(refresh, 100);
    });

    controls.searchClear.addEventListener("click", () => {
      window.clearTimeout(searchTimer);
      state.query = "";
      controls.search.value = "";
      controls.searchClear.hidden = true;
      controls.search.focus();
      refresh();
    });

    controls.category.addEventListener("change", () => {
      state.category = controls.category.value;
      refresh();
    });

    controls.weather?.addEventListener("change", () => {
      state.weather = controls.weather.value;
      refresh();
    });

    controls.location?.addEventListener("change", () => {
      state.location = controls.location.value;
      refresh();
    });

    controls.hideOneFour.addEventListener("change", () => {
      state.hideRatedOneToFour = controls.hideOneFour.checked;
      refresh();
    });

    controls.hideFive.addEventListener("change", () => {
      state.hideRatedFive = controls.hideFive.checked;
      refresh();
    });

    controls.sort.addEventListener("change", () => {
      state.sort = controls.sort.value;
      refresh();
    });

    const reset = () => {
      window.clearTimeout(searchTimer);
      resetFilterState(state, controls);
      refresh();
    };
    controls.reset.addEventListener("click", reset);
    controls.emptyReset.addEventListener("click", reset);
  }

  function resetFilterState(state, controls) {
    state.query = "";
    state.category = "";
    state.weather = "";
    state.location = "";
    state.hideRatedOneToFour = false;
    state.hideRatedFive = false;
    state.sort = "original";

    controls.search.value = "";
    controls.searchClear.hidden = true;
    controls.category.value = "";
    if (controls.weather) controls.weather.value = "";
    if (controls.location) controls.location.value = "";
    controls.hideOneFour.checked = false;
    controls.hideFive.checked = false;
    controls.sort.value = "original";
  }

  function bindRatingActions(collection, content, items, state, controls) {
    content.addEventListener("click", (event) => {
      const ratingButton = event.target.closest("[data-rating-value]");
      if (!ratingButton) {
        return;
      }

      const itemId = ratingButton.dataset.itemId;
      const item = items.find((candidate) => candidate.nameEn === itemId);
      if (!item) {
        return;
      }

      const selectedRating = Number(ratingButton.dataset.ratingValue);
      const rating = readRating(collection.key, item.nameEn) === selectedRating ? 0 : selectedRating;
      writeRating(collection.key, item.nameEn, rating);
      updateProgress(collection, document.querySelector("[data-collection-root]"), items);
      renderResults(collection, items, state, controls);
    });
  }

  function renderResults(collection, items, state, controls) {
    const visibleItems = filterAndSortItems(collection, items, state);
    controls.visibleCount.textContent = visibleItems.length.toLocaleString("ja-JP");
    controls.totalCount.textContent = items.length.toLocaleString("ja-JP");
    controls.table.hidden = visibleItems.length === 0;
    controls.empty.hidden = visibleItems.length !== 0;

    if (visibleItems.length === 0) {
      controls.grid.innerHTML = "";
      return;
    }

    controls.grid.innerHTML = visibleItems.map((item) => renderCollectionCard(collection, item)).join("");
    bindImageFallbacks(controls.grid);
  }

  function filterAndSortItems(collection, items, state) {
    const terms = normalizeText(state.query).split(/\s+/).filter(Boolean);
    const filtered = items.filter((item) => {
      if (terms.length > 0) {
        const haystack = item._searchText;
        if (!terms.every((term) => haystack.includes(term))) {
          return false;
        }
      }

      const classification = getClassification(collection, item);
      if (state.category && classification.key !== state.category) {
        return false;
      }

      if (state.weather && !matchesWeather(item, state.weather)) {
        return false;
      }

      if (state.location && !matchesLocation(collection, item, state.location)) {
        return false;
      }

      const rating = readRating(collection.key, item.nameEn);
      if (state.hideRatedOneToFour && rating >= 1 && rating <= 4) {
        return false;
      }
      if (state.hideRatedFive && rating === 5) {
        return false;
      }

      return true;
    });

    return filtered.sort((a, b) => compareItems(collection, a, b, state.sort));
  }

  function createSearchText(collection, item) {
    let values;
    if (collection.key === "gourmet") {
      values = [
        item.nameJa,
        item.nameEn,
        ...(item.events || []),
        ...(item.ingredients || []).flatMap((ingredient) => [
          ingredient.name,
          ...(ingredient.alternatives || [])
        ])
      ];
    } else {
      const labels = collection.key === "bird"
        ? ["名前", "出現条件", "撮影距離", "星5撮影条件", "天気", "時間", "場所", "売値"]
        : collection.key === "fish"
          ? ["名前", "出現条件", "サイズ", "天気", "時間", "場所", "売値"]
          : ["名前", "出現条件", "出現方法", "天気", "時間", "場所", "売値"];
      values = [labels, flattenValues(item)];
    }

    return normalizeText(flattenValues(values).join(" "));
  }

  function flattenValues(value) {
    if (Array.isArray(value)) {
      return value.flatMap(flattenValues);
    }
    if (value && typeof value === "object") {
      return Object.entries(value)
        .filter(([key]) => !key.startsWith("_"))
        .flatMap(([, entry]) => flattenValues(entry));
    }
    if (value === null || value === undefined) {
      return [];
    }
    return [String(value)];
  }

  function normalizeText(value) {
    return String(value || "").normalize("NFKC").toLocaleLowerCase("ja-JP");
  }

  function matchesWeather(item, selectedWeather) {
    const weathers = item.weathers || [];
    return weathers.includes(selectedWeather)
      || (selectedWeather !== "全天気" && weathers.includes("全天気"));
  }

  function matchesLocation(collection, item, selectedLocation) {
    const locations = item.locations || [];
    if (locations.includes(selectedLocation)) {
      return true;
    }

    if (collection.key !== "fish" || !item.waterType) {
      return false;
    }

    return locations.includes(`全${item.waterType}`) && selectedLocation.includes(item.waterType);
  }

  function compareItems(collection, a, b, sort) {
    let comparison = 0;

    if (sort === "level") {
      comparison = a.level - b.level;
    } else if (sort === "name") {
      comparison = a.nameJa.localeCompare(b.nameJa, "ja");
    } else if (sort === "price" && collection.key === "gourmet") {
      comparison = getGourmetSortPrice(b) - getGourmetSortPrice(a);
    } else if (sort === "incomplete") {
      const aCompleted = readRating(collection.key, a.nameEn) === 5 ? 1 : 0;
      const bCompleted = readRating(collection.key, b.nameEn) === 5 ? 1 : 0;
      comparison = aCompleted - bCompleted;
    }

    return comparison || a._index - b._index;
  }

  function getGourmetSortPrice(item) {
    const prices = item.prices || [];
    const coinPrice = prices.find((price) => price.currency === "コイン");
    const preferredPrice = coinPrice || prices[0];
    return Number.isFinite(preferredPrice?.amount) ? preferredPrice.amount : Number.NEGATIVE_INFINITY;
  }

  function getClassification(collection, item) {
    if ((item.events || []).length > 0) {
      return { key: "event", label: "イベント" };
    }
    if (item.level >= 11) {
      return { key: "advanced", label: "上級" };
    }
    if (collection.key === "fish") {
      const waterTypes = {
        "川": { key: "river", label: "川" },
        "湖": { key: "lake", label: "湖" },
        "海": { key: "sea", label: "海" }
      };
      return waterTypes[item.waterType] || { key: "sea", label: item.waterType || "海" };
    }
    return { key: "normal", label: "通常" };
  }

  function renderCollectionCard(collection, item) {
    const classification = getClassification(collection, item);
    const rating = readRating(collection.key, item.nameEn);
    const imagePath = `assets/images/items/${collection.key}/${encodeURIComponent(item.nameEn)}.webp`;
    const eventMarkup = item.events.length > 0
      ? `<p class="collection-card__event">${escapeHTML(item.events.join(" / "))}</p>`
      : "";

    const image = `
        <figure class="collection-card__image">
          <img src="${imagePath}" alt="${escapeHTML(item.nameJa)}" data-item-image loading="lazy">
        </figure>`;
    const identity = `
        <section class="collection-card__identity">
          <div class="collection-card__meta">
            <span>${escapeHTML(classification.label)}</span>
            <span>Lv.${escapeHTML(item.level)}</span>
          </div>
          <h2>${escapeHTML(item.nameJa)}</h2>
          ${eventMarkup}
        </section>`;
    const sale = `
        <div class="collection-card__sale">
          ${renderSales(item.prices)}
        </div>`;
    const itemRating = `
        <div class="collection-card__rating">
          ${renderRecordRating(item, rating)}
        </div>`;

    if (collection.key === "gourmet") {
      return `
        <article class="collection-card collection-card--gourmet" data-item-id="${escapeHTML(item.nameEn)}" data-rating="${rating}">
          ${image}
          ${identity}
          <div class="collection-card__information">
            ${renderRecipe(item.ingredients)}
          </div>
          <div class="collection-card__detail">
            ${sale}
            <div class="collection-card__energy">
              ${renderEnergy(item.energy)}
            </div>
          </div>
          ${itemRating}
        </article>`;
    }

    return `
      <article class="collection-card collection-card--${collection.key}" data-item-id="${escapeHTML(item.nameEn)}" data-rating="${rating}">
        ${image}
        ${identity}
        <div class="collection-card__occurrence">
          <div class="collection-card__location">
            <i class="collection-card__fact-icon mgc_location_fill"></i>
            <span>${escapeHTML(item.locations.join("・"))}</span>
          </div>
          <div class="collection-card__weather">
            <i class="collection-card__fact-icon mgc_cloud_fill"></i>
            ${renderWeatherSymbols(item.weathers)}
          </div>
          <div class="collection-card__time">
            <i class="collection-card__fact-icon mgc_time_fill"></i>
            ${renderTimeValues(item.times)}
          </div>
        </div>
        <div class="collection-card__detail">
          <div class="collection-card__specific">${renderSpecificValue(collection, item)}</div>
          ${sale}
        </div>
        ${itemRating}
      </article>`;
  }

  function renderSpecificValue(collection, item) {
    if (collection.key === "bird") {
      const distance = item.distanceMeters === null
        ? ""
        : `<span class="collection-card__distance"><strong>${escapeHTML(item.distanceMeters)}</strong><small>m</small></span>`;
      return `<span class="bird-condition">${distance}${renderBirdFiveStarValues(item)}</span>`;
    }
    if (collection.key === "fish") {
      return renderFishShadow(item.shadow);
    }
    return renderSpawnSurfaces(item.spawnSurfaces);
  }

  function renderFishShadow(shadow) {
    if (!shadow) {
      return "";
    }

    const shadowKinds = {
      "小": "small",
      "中": "medium",
      "大": "large",
      "金": "gold"
    };
    const kind = shadowKinds[shadow] || "device";
    return `<span class="fish-shadow fish-shadow--${kind}">
      <i class="mgc_fish_fill"></i>
      <strong>${escapeHTML(shadow)}</strong>
    </span>`;
  }

  function renderSpawnSurfaces(values) {
    const entries = values.filter(Boolean);
    if (entries.length === 0) {
      return "";
    }

    return `<span class="spawn-values">${entries
      .map((value) => `<span class="spawn-value">${escapeHTML(value)}</span>`)
      .join("")}</span>`;
  }

  function renderBirdFiveStarValues(item) {
    if (item.fiveStarWeathers.length === 0 && item.fiveStarTimes.length === 0 && !item.fiveStarAction) {
      return "";
    }

    const values = [];
    if (item.fiveStarWeathers.length > 0) {
      values.push(`<span class="five-star-values__weather">${renderWeatherSymbols(item.fiveStarWeathers)}</span>`);
    }
    if (item.fiveStarTimes.length > 0) {
      values.push(`<span class="five-star-values__time">${renderTimeValues(item.fiveStarTimes)}</span>`);
    }
    if (item.fiveStarAction) {
      values.push(`<span class="five-star-values__action">${escapeHTML(item.fiveStarAction)}</span>`);
    }

    return `<span class="five-star-values">${values.join("")}</span>`;
  }

  function renderTimeValues(values) {
    return `<span class="time-values">${values
      .map((value) => `<span>${escapeHTML(value)}</span>`)
      .join("")}</span>`;
  }

  function renderWeatherSymbols(values) {
    return `<span class="weather-symbols">${values.map((weather) => {
      if (weather === "全天気") {
        return '<span class="weather-symbols__text">全天気</span>';
      }

      const icon = WEATHER_ICONS[weather] || "mgc_question_fill";
      return `<i class="${icon}"></i>`;
    }).join("")}</span>`;
  }

  function renderRecipe(ingredients) {
    if (ingredients.length === 0) {
      return "";
    }

    let remainingSlots = RECIPE_SLOT_LIMIT;
    const rows = ingredients.map((ingredient) => {
      const imagePath = `assets/images/ingredients/${encodeURIComponent(ingredient.name)}.webp`;
      const requestedSlots = Number.isInteger(ingredient.quantity) && ingredient.quantity > 0
        ? ingredient.quantity
        : 1;
      const slotCount = Math.min(requestedSlots, remainingSlots);
      remainingSlots -= slotCount;

      return Array.from({ length: slotCount }, () => `<div class="card-recipe__item">
          <figure class="card-recipe__image">
            <img src="${imagePath}" alt="${escapeHTML(ingredient.name)}" data-ingredient-image loading="lazy">
          </figure>
          <div class="card-recipe__body">
            <span class="card-recipe__name">${escapeHTML(ingredient.name)}</span>
          </div>
        </div>`).join("");
    }).join("");

    return `<div class="card-recipe">${rows}</div>`;
  }

  function renderSales(prices) {
    if (prices.length === 0) {
      return "";
    }

    const currencyTypes = {
      "コイン": "coin",
      "トレンドコイン": "trend",
      "フェスコイン": "festival"
    };
    const tokens = prices.map((price) => {
      const type = currencyTypes[price.currency] || "other";
      return `<span class="price-token price-token--${type}"><i class="mgc_coin_fill"></i><strong>${Number(price.amount).toLocaleString("ja-JP")}</strong></span>`;
    }).join("");
    return `<div class="price-tokens">${tokens}</div>`;
  }

  function renderEnergy(energy) {
    if (!Number.isFinite(energy)) {
      return "";
    }

    return `<span class="energy-token"><i class="mgc_lightning_fill"></i><strong>${Number(energy).toLocaleString("ja-JP")}</strong></span>`;
  }

  function renderRecordRating(item, rating) {
    const stars = [1, 2, 3, 4, 5].map((value) => {
      const activeClass = value <= rating ? " is-active" : "";
      return `<button class="card-rating__star${activeClass}" type="button" data-rating-value="${value}" data-item-id="${escapeHTML(item.nameEn)}"><i class="mgc_star_fill"></i></button>`;
    }).join("");

    return `<div class="card-rating">${stars}</div>`;
  }

  function bindImageFallbacks(container) {
    container.querySelectorAll("img[data-item-image], img[data-ingredient-image]").forEach((image) => {
      const showFallback = () => {
        if (image.matches("[data-ingredient-image]")) {
          image.removeEventListener("error", showFallback);
          image.src = INGREDIENT_PLACEHOLDER_PATH;
          image.alt = "";
          image.closest(".card-recipe__image")?.classList.add("is-placeholder");
          return;
        }

        image.hidden = true;
      };

      image.addEventListener("error", showFallback);
      if (image.complete && image.naturalWidth === 0) {
        showFallback();
      }
    });
  }

  function updateProgress(collection, collectionRoot, items) {
    const completed = items.reduce((count, item) => count + (readRating(collection.key, item.nameEn) === 5 ? 1 : 0), 0);
    const total = items.length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

    const completedElement = collectionRoot.querySelector("[data-progress-complete]");
    const totalElement = collectionRoot.querySelector("[data-progress-total]");
    const rateElement = collectionRoot.querySelector("[data-progress-rate]");
    const barElement = collectionRoot.querySelector("[data-progress-bar]");

    if (completedElement) completedElement.textContent = completed.toLocaleString("ja-JP");
    if (totalElement) totalElement.textContent = total.toLocaleString("ja-JP");
    if (rateElement) rateElement.textContent = `${rate}%`;
    if (barElement) barElement.style.width = `${rate}%`;
  }

  function readRating(collectionKey, itemId) {
    try {
      const value = Number(localStorage.getItem(createRatingKey(collectionKey, itemId)));
      return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 0;
    } catch (_error) {
      return 0;
    }
  }

  function writeRating(collectionKey, itemId, rating) {
    try {
      const key = createRatingKey(collectionKey, itemId);
      if (rating >= 1 && rating <= 5) {
        localStorage.setItem(key, String(rating));
      } else {
        localStorage.removeItem(key);
      }
    } catch (_error) {
      // localStorageが利用できない環境でも一覧表示を継続します。
    }
  }

  function createRatingKey(collectionKey, itemId) {
    return `heartopia:rating:${collectionKey}:${itemId}`;
  }

  function renderLoadingState(label) {
    return `<div class="loading-state"><div class="state-content"><span class="state-icon"><i class="mgc_refresh_2_fill"></i></span><h2>${escapeHTML(label)}の情報を読込中です</h2><p>データの表示までお待ちください。</p></div></div>`;
  }

  function renderErrorState(label) {
    return `<div class="error-state"><div class="state-content"><span class="state-icon"><i class="mgc_warning_fill"></i></span><h2>${escapeHTML(label)}の情報を読み込めませんでした</h2><p>ページを再読込してください。</p><button type="button" data-retry><i class="mgc_refresh_2_fill"></i>再読込</button></div></div>`;
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
